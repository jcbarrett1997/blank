/*
 * MB Storage - online booking (Netlify Function)
 *
 * Takes a booking request, re-checks availability server-side, then creates
 * a Stripe Checkout session for the refundable deposit PLUS the first rent
 * payment (pro-rata to the end of the move-in month; when moving in within
 * 7 days of month-end, the following month is included too, so the customer
 * isn't invoiced again days after paying). Paying in full at booking means
 * a unit is only ever held by money, never by a promise - no chase-up
 * window, no double-booking race on the last unit. Payment confirmation
 * (emails etc.) is handled by stripe-webhook.js.
 *
 * Batley and Liversedge are separate companies with separate bank accounts,
 * so each has its own Stripe account - the key is chosen by site:
 *
 *   STRIPE_SECRET_KEY_BATLEY       Stripe secret key for the Batley company
 *   STRIPE_SECRET_KEY_LIVERSEDGE   Stripe secret key for the Liversedge company
 *   AVAILABILITY_SHEET_CSV_URL     published-CSV URL of the availability sheet
 *   SITE_URL                       e.g. "https://www.mbstorage.co.uk"
 *
 * Nothing is configured in the repo - all keys live in Netlify env vars.
 */

var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');
var qb = require('./lib/quickbooks');

/* Prices (server-side only - never trusted from, or exposed to, the browser). */
var VAT_RATE = 0.20;
var UNITS = {
  '20ft': { label: '20ft × 8ft storage container', pcmExVat: 160.00, depositPence: 15000 },
  '8ft':  { label: '8ft × 6ft 6in storage container', pcmExVat: 82.50, depositPence: 7500 }
};

var SITES = {
  batley:     { label: 'Batley',     keyEnv: 'STRIPE_SECRET_KEY_BATLEY' },
  liversedge: { label: 'Liversedge', keyEnv: 'STRIPE_SECRET_KEY_LIVERSEDGE' }
};

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* First rent payment for a move-in date: pro-rata (daily rate) from the
   move-in day to the end of that month, inc VAT. Moving in within 7 days
   of month-end also includes the following month, so the customer isn't
   invoiced again days after paying. */
function rentBreakdown(u, moveInISO) {
  var mv = new Date(moveInISO + 'T12:00:00');
  if (isNaN(mv.getTime())) return null;
  var y = mv.getFullYear(), m = mv.getMonth(), day = mv.getDate();
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var remaining = daysInMonth - day + 1;
  var exVat = u.pcmExVat * remaining / daysInMonth;
  var period = (day === 1) ? MONTHS[m] : (day + '-' + daysInMonth + ' ' + MONTHS[m]);
  if (remaining <= 7) {
    exVat += u.pcmExVat;
    var nextM = (m + 1) % 12;
    period += ' + ' + MONTHS[nextM];
  }
  return {
    pence: Math.round(exVat * (1 + VAT_RATE) * 100),
    period: period
  };
}

function money(pence) { return '£' + (pence / 100).toFixed(2); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Same provider-agnostic sender as quote.js (Mailgun or Resend). */
function makeSender() {
  if (process.env.RESEND_API_KEY) {
    return async function (msg) {
      var r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()));
      return r.json();
    };
  }
  return async function (msg) {
    var base = process.env.MAILGUN_API_BASE || 'https://api.mailgun.net';
    var form = new URLSearchParams();
    form.append('from', msg.from);
    form.append('to', Array.isArray(msg.to) ? msg.to.join(',') : msg.to);
    if (msg.reply_to) form.append('h:Reply-To', msg.reply_to);
    form.append('subject', msg.subject);
    if (msg.html) form.append('html', msg.html);
    if (msg.text) form.append('text', msg.text);
    var r = await fetch(base + '/v3/' + process.env.MAILGUN_DOMAIN + '/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('api:' + process.env.MAILGUN_API_KEY).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    if (!r.ok) throw new Error('Mailgun ' + r.status + ': ' + (await r.text()));
    return r.json();
  };
}

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';

/* Upfront (6/12 month) bookings skip card payment entirely - card fees on
   those sums would be excessive. The discounted invoice is created and
   emailed automatically via QuickBooks (deposit + 6/12 months from the
   move-in date, discount on the whole rent); if QuickBooks isn't
   configured or fails, the emails fall back to "we'll be in touch ASAP"
   and MB Storage raises the invoice by hand. */
async function handleUpfrontRequest(d, site, unit, rent) {
  var months = d.payment_preference.indexOf('12') === 0 ? 12 : 6;
  var discount = months === 12 ? 0.10 : 0.05;
  var pct = months === 12 ? '10%' : '5%';

  var fmtDate = function (dt) { return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear(); };
  var mv = new Date(d.move_in_date + 'T12:00:00');
  var end = new Date(mv); end.setMonth(end.getMonth() + months); end.setDate(end.getDate() - 1);
  var periodLabel = fmtDate(mv) + ' - ' + fmtDate(end);
  var rentGrossPence = Math.round(unit.pcmExVat * months * (1 - discount) * (1 + VAT_RATE) * 100);
  var totalPence = rentGrossPence + unit.depositPence;
  var savedPence = Math.round(unit.pcmExVat * months * discount * (1 + VAT_RATE) * 100);

  // Create and email the discounted invoice via QuickBooks (best-effort)
  var qbInvoice = null;
  if (qb.configured()) {
    try {
      qbInvoice = await qb.recordInvoice((d.site || '').toLowerCase(), {
        name: d.name, email: d.email, phone: d.phone,
        depositAmount: unit.depositPence / 100,
        depositLabel: 'Refundable deposit - ' + unit.label + ' (' + site.label + ')',
        rentAmount: rentGrossPence / 100,
        rentLabel: 'Storage rent, ' + d.payment_preference + ' (' + periodLabel + ') at ' + pct + ' discount - ' + unit.label + ' (' + site.label + ')',
        txnDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        note: 'Upfront online booking request (' + d.payment_preference + ', ' + pct + ' discount). Created automatically by the website.'
      });
    } catch (err) {
      console.error('Upfront invoice automation failed (falling back to manual):', err.message);
    }
  }
  var invoiceSent = !!(qbInvoice && qbInvoice.emailed);
  var invoiceNo = qbInvoice && qbInvoice.invoice && (qbInvoice.invoice.DocNumber || qbInvoice.invoice.Id);

  // Mark as booked so quote follow-ups leave them alone (best-effort)
  try {
    var blobs = require('./lib/blobs');
    await blobs.store('quote-log').setJSON('booked-' + String(d.email).trim().toLowerCase(), { ts: Date.now() });
  } catch (e) { console.error('Booked marker failed:', e); }

  var send = makeSender();

  var rowH = function (k, v) {
    return '<tr><td style="padding:5px 12px 5px 0;color:#5b5648;font-size:14px">' + esc(k) +
           '</td><td style="padding:5px 0;color:#22303a;font-size:14px;font-weight:600">' + esc(v || ' - ') + '</td></tr>';
  };

  // 1) Customer acknowledgement
  await send({
    from: FROM, to: [String(d.email).trim()], reply_to: TO,
    subject: 'Your MB Storage booking request - discounted invoice on its way',
    html:
      '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
        '<tr><td style="background:#ffffff;padding:22px 28px" align="left"><img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="44" style="height:44px;display:block"></td></tr>' +
        '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
        '<tr><td style="padding:28px">' +
          '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc((d.name || 'there').trim()) + ',</p>' +
          (invoiceSent
            ? '<p style="margin:0 0 16px;font-size:15px;color:#5b5648;line-height:1.6"><strong style="color:#008a3f">Great choice - your booking request is in, and your discounted invoice is already on its way.</strong> It\'s been emailed to you separately from our accounts system (QuickBooks) - check your inbox (and spam folder) for it now. Nothing to pay by card; the invoice has the payment details.</p>'
            : '<p style="margin:0 0 16px;font-size:15px;color:#5b5648;line-height:1.6"><strong style="color:#008a3f">Great choice - your booking request is in.</strong> Because you\'re paying ' + esc(d.payment_preference) + ' (saving ' + pct + '), there\'s nothing to pay by card today. We\'ll be in touch <strong>as soon as possible</strong> (usually the same day) with your invoice at the discounted rate.</p>') +
          '<div style="background:#f7f6f3;border:1px solid #e4e1da;border-radius:12px;padding:18px 20px;margin-bottom:16px">' +
            '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#008a3f;font-weight:700">Your request</p>' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
              rowH('Unit', unit.label) + rowH('Site', site.label) +
              rowH('Move-in date', d.move_in_date) +
              rowH('Paying', d.payment_preference + ' (save ' + pct + ')') +
              rowH('Rent period covered', periodLabel) +
              '<tr><td colspan="2" style="border-top:1px solid #e4e1da;padding-top:10px"></td></tr>' +
              rowH('Refundable deposit', money(unit.depositPence)) +
              rowH('Rent (' + pct + ' off, inc. VAT)', money(rentGrossPence)) +
              rowH('Total due', money(totalPence)) +
              rowH('You save', money(savedPence)) +
            '</table>' +
          '</div>' +
          '<p style="margin:0 0 16px;font-size:13px;color:#5b5648;line-height:1.6"><strong>Please note:</strong> a booking request doesn\'t reserve your unit - units go to whoever pays first, so your unit is only secured once your invoice is paid. That\'s why we\'ll be in touch as soon as possible to get everything sorted with you. Questions in the meantime? Just reply to this email or call us.</p>' +
          '<a href="tel:+447375355233" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px">Call us: 07375 355233</a>' +
        '</td></tr>' +
        '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; <a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; <a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a></td></tr>' +
      '</table></td></tr></table></div>',
    text: [
      'Hi ' + (d.name || 'there').trim() + ',', '',
      (invoiceSent
        ? 'Great choice - your booking request is in, and your discounted invoice is already on its way. It\'s been emailed to you separately from our accounts system (QuickBooks) - check your inbox (and spam folder) for it now. Nothing to pay by card; the invoice has the payment details.'
        : 'Great choice - your booking request is in. Because you\'re paying ' + d.payment_preference + ' (saving ' + pct + '), there\'s nothing to pay by card today. We\'ll be in touch as soon as possible (usually the same day) with your invoice at the discounted rate.'), '',
      'YOUR REQUEST', '----------------------------------------',
      'Unit: ' + unit.label,
      'Site: ' + site.label,
      'Move-in date: ' + d.move_in_date,
      'Paying: ' + d.payment_preference + ' (save ' + pct + ')',
      'Rent period covered: ' + periodLabel,
      'Refundable deposit: ' + money(unit.depositPence),
      'Rent (' + pct + ' off, inc. VAT): ' + money(rentGrossPence),
      'Total due: ' + money(totalPence),
      'You save: ' + money(savedPence), '',
      'PLEASE NOTE: a booking request doesn\'t reserve your unit - units go to whoever pays first, so your unit is only secured once your invoice is paid. That\'s why we move fast - pay your invoice and you\'re in.', '',
      'Questions? Reply to this email or call 07375 355233.', '',
      'Kind regards,', 'MB Storage',
      '07375 355233 | info@mbstorage.co.uk | mbstorage.co.uk'
    ].join('\n')
  });

  // 2) Internal notification - either "invoice already sent, watch for
  //    payment" or "automation failed, raise it by hand ASAP"
  await send({
    from: FROM, to: [TO], reply_to: String(d.email).trim(),
    subject: (invoiceSent
      ? 'UPFRONT BOOKING - invoice #' + invoiceNo + ' sent automatically - ' + (d.name || '?') + ' (' + site.label + ')'
      : 'UPFRONT BOOKING REQUEST - send discounted invoice - ' + (d.name || '?') + ' (' + site.label + ')'),
    html:
      '<div style="font-family:Segoe UI,Arial,sans-serif;color:#22303a">' +
      '<h2 style="color:#008a3f">UPFRONT BOOKING - ' + esc(d.payment_preference) + '</h2>' +
      (invoiceSent
        ? '<p style="color:#008a3f;font-weight:700">Invoice #' + esc(invoiceNo) + ' (' + money(totalPence) + ', due in 3 days) was created in ' + esc(site.label) + '\'s QuickBooks and emailed to the customer automatically. Nothing to raise - just watch for the payment and confirm the move-in once it lands.</p>'
        : (qbInvoice
          ? '<p style="color:#b3261e;font-weight:700">Invoice #' + esc(invoiceNo) + ' was created in ' + esc(site.label) + '\'s QuickBooks but the automatic email to the customer FAILED - open it in QuickBooks and hit Save and send ASAP. The customer has been told we\'ll be in touch.</p>'
          : '<p style="color:#b3261e;font-weight:700">Action needed ASAP: the automatic invoice could not be created (check Netlify function logs for \'Upfront invoice automation failed\'). Raise and send the discounted invoice (' + pct + ' off) by hand - the customer has been told we\'ll be in touch. No card payment was taken.</p>')) +
      '<table role="presentation" cellpadding="0" cellspacing="0">' +
        rowH('Name', d.name) + rowH('Email', d.email) + rowH('Phone', d.phone) +
        rowH('Unit', unit.label) + rowH('Site', site.label) +
        rowH('Move-in date', d.move_in_date) +
        rowH('Storing', d.storing) +
        rowH('Paying', d.payment_preference + ' (' + pct + ' discount)') +
        rowH('Rent period covered', periodLabel) +
        rowH('Deposit', money(unit.depositPence)) +
        rowH('Rent (' + pct + ' off, inc. VAT)', money(rentGrossPence)) +
        rowH('TOTAL DUE', money(totalPence)) +
        rowH('Reference - standard first rent if paying monthly (' + rent.period + ')', money(rent.pence)) +
        rowH('Agreed to T&Cs', 'yes - ' + new Date().toISOString()) +
      '</table></div>'
  });
}

function json(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function unitsFree(site, size) {
  var url = process.env.AVAILABILITY_SHEET_CSV_URL;
  if (!url) return null; // availability not configured - don't block bookings on it
  try {
    var r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    var rows = (await r.text()).split(/\r?\n/).map(function (l) {
      return l.split(',').map(function (c) { return c.replace(/^"|"$/g, '').trim().toLowerCase(); });
    });
    var head = rows[0], iSite = head.indexOf('site'), iSize = head.indexOf('size'), iFree = head.indexOf('units_free');
    if (iSite === -1 || iSize === -1 || iFree === -1) return null;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][iSite] === site && rows[i][iSize] === size) return parseInt(rows[i][iFree], 10);
    }
  } catch (e) { console.error(e); }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  var d;
  try { d = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'Bad request' }); }

  // Honeypot - silently succeed for bots
  if (d._honey || d.company) return json(200, { ok: true });

  var site = SITES[(d.site || '').toLowerCase()];
  var unit = UNITS[d.container_size];
  if (!site) return json(400, { ok: false, error: 'Please choose a site.' });
  if (!unit) return json(400, { ok: false, error: 'Please choose a container size.' });
  if (d.container_size === '8ft' && (d.site || '').toLowerCase() !== 'batley') {
    return json(400, { ok: false, error: '8ft containers are available at our Batley site only.' });
  }
  if (!d.name || !String(d.name).trim()) return json(400, { ok: false, error: 'Please tell us your name.' });
  if (!d.email || String(d.email).indexOf('@') === -1) return json(400, { ok: false, error: 'A valid email is required.' });
  if (!d.phone || !String(d.phone).trim()) return json(400, { ok: false, error: 'A phone number is required.' });
  if (d.terms_agreed !== 'yes' && d.terms_agreed !== 'on' && d.terms_agreed !== true) {
    return json(400, { ok: false, error: 'Please confirm you agree to our Terms & Conditions.' });
  }

  // Move-in date is required - the first rent payment is calculated from it
  if (!d.move_in_date) return json(400, { ok: false, error: 'Please choose your move-in date.' });

  // Bookings are only taken up to 3 days ahead - we can't guarantee
  // availability further out (browser enforces this too; this is the backstop)
  var picked = new Date(d.move_in_date + 'T12:00:00');
  var latest = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  latest.setHours(23, 59, 59, 999);
  var earliest = new Date(); earliest.setHours(0, 0, 0, 0);
  if (isNaN(picked.getTime()) || picked > latest || picked < earliest) {
    return json(400, { ok: false, error: 'Bookings can be made up to 3 days in advance. For later move-in dates, please get in touch and we\'ll see what we can arrange.' });
  }

  var rent = rentBreakdown(unit, d.move_in_date);
  if (!rent) return json(400, { ok: false, error: 'Please choose a valid move-in date.' });

  // Availability re-check (authoritative, server-side)
  var free = await unitsFree((d.site || '').toLowerCase(), d.container_size);
  if (free !== null && free <= 0) {
    return json(409, { ok: false, error: 'Sorry - that size has just sold out at ' + site.label + '. Call us on 07375 355233 and we\'ll help.' });
  }

  // Upfront payers don't pay by card (fees would be excessive on those
  // sums) - their request is emailed in and a discounted invoice follows
  if (d.payment_preference === '6 months upfront' || d.payment_preference === '12 months upfront') {
    try {
      await handleUpfrontRequest(d, site, unit, rent);
      return json(200, { ok: true, url: '/booking-requested.html' });
    } catch (err) {
      console.error(err);
      return json(502, { ok: false, error: 'Could not send your request. Please try again or call 07375 355233.' });
    }
  }

  var key = process.env[site.keyEnv];
  if (!key) return json(503, { ok: false, error: 'Online booking is not available just yet. Please use the quote form or call 07375 355233.' });

  // Create the Stripe Checkout session (form-encoded REST call - no SDK needed)
  var form = new URLSearchParams();
  form.append('mode', 'payment');
  form.append('line_items[0][quantity]', '1');
  form.append('line_items[0][price_data][currency]', 'gbp');
  form.append('line_items[0][price_data][unit_amount]', String(unit.depositPence));
  form.append('line_items[0][price_data][product_data][name]', 'Refundable deposit - ' + unit.label + ' (' + site.label + ')');
  form.append('line_items[0][price_data][product_data][description]', 'Refunded in full when you leave, provided the unit is left as found.');
  form.append('line_items[1][quantity]', '1');
  form.append('line_items[1][price_data][currency]', 'gbp');
  form.append('line_items[1][price_data][unit_amount]', String(rent.pence));
  form.append('line_items[1][price_data][product_data][name]', 'First rent payment - ' + rent.period);
  form.append('line_items[1][price_data][product_data][description]', 'Your hire to the end of the period, including VAT. Rent is then invoiced monthly on the 1st.');
  // If they cancel at the card screen, send them back with the form still filled
  var backParams = new URLSearchParams();
  backParams.set('site', (d.site || '').toLowerCase());
  backParams.set('size', d.container_size || '');
  ['name', 'email', 'phone', 'move_in_date', 'payment_preference'].forEach(function (k) {
    if (d[k]) backParams.set(k, String(d[k]).slice(0, 100));
  });

  form.append('customer_email', String(d.email).trim());
  form.append('success_url', SITE + '/booking-confirmed.html');
  form.append('cancel_url', SITE + '/book.html?' + backParams.toString());
  form.append('payment_intent_data[description]', 'MB Storage booking - deposit + rent (' + rent.period + ') - ' + unit.label + ' at ' + site.label);
  ['name', 'phone', 'move_in_date', 'storing', 'payment_preference'].forEach(function (k) {
    if (d[k]) form.append('metadata[' + k + ']', String(d[k]).slice(0, 450));
  });
  form.append('metadata[site]', site.label);
  form.append('metadata[container_size]', d.container_size);
  form.append('metadata[terms_agreed]', 'yes - ' + new Date().toISOString());
  form.append('metadata[deposit_amount_gbp]', (unit.depositPence / 100).toFixed(2));
  form.append('metadata[rent_amount_gbp]', (rent.pence / 100).toFixed(2));
  form.append('metadata[deposit_paid]', money(unit.depositPence));
  form.append('metadata[rent_paid]', money(rent.pence));
  form.append('metadata[rent_period]', rent.period);

  try {
    var r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    var session = await r.json();
    if (!r.ok) { console.error('Stripe error:', JSON.stringify(session)); return json(502, { ok: false, error: 'Could not start payment. Please try again or call 07375 355233.' }); }
    return json(200, { ok: true, url: session.url });
  } catch (err) {
    console.error(err);
    return json(502, { ok: false, error: 'Could not start payment. Please try again or call 07375 355233.' });
  }
};
