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

  var key = process.env[site.keyEnv];
  if (!key) return json(503, { ok: false, error: 'Online booking is not available just yet. Please use the quote form or call 07375 355233.' });

  // Availability re-check (authoritative, server-side)
  var free = await unitsFree((d.site || '').toLowerCase(), d.container_size);
  if (free !== null && free <= 0) {
    return json(409, { ok: false, error: 'Sorry - that size has just sold out at ' + site.label + '. Call us on 07375 355233 and we\'ll help.' });
  }

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
