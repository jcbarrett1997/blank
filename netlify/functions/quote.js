/*
 * MB Storage - instant quote handler (Netlify Function)
 *
 * Receives the quote form, calculates the price SERVER-SIDE (so pricing is
 * never exposed to the browser), then sends two emails:
 *   1. the customer's personalised quote (from a verified @mbstorage.co.uk sender)
 *   2. a notification to the MB Storage inbox
 *
 * Works with EITHER email provider - set whichever provider's variables in the
 * Netlify dashboard (never in the repo):
 *
 *   Mailgun:  MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_API_BASE (optional, use
 *             "https://api.eu.mailgun.net" for the EU region)
 *   Resend:   RESEND_API_KEY
 *
 *   Shared:   MAIL_FROM  e.g. "MB Storage <quotes@mbstorage.co.uk>"
 *             MAIL_TO    where enquiries are sent, e.g. "info@mbstorage.co.uk"
 *             SITE_URL   e.g. "https://www.mbstorage.co.uk" (used for the logo)
 *
 * Marketing (optional): when the customer ticks the opt-in box, their details
 * are added to a MailerLite group. This is best-effort - if it is not
 * configured or fails, the quote email is still sent as normal.
 *
 *   MailerLite:  MAILERLITE_API_KEY   (from MailerLite: Integrations > API)
 *                MAILERLITE_GROUP_ID  the group ("Website enquiries") to add to
 */

var VAT_RATE = 0.20;
var UNITS = {
  '20ft': { label: '20ft × 8ft storage container', sqft: '≈160 sq ft', pcmExVat: 160.00, deposit: 150.00, avail: 'Available at all our sites' },
  '8ft':  { label: '8ft × 6ft 6in storage container', sqft: '≈52 sq ft', pcmExVat: 82.50, deposit: 75.00, avail: 'Available at our Batley site only' }
};

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');

var PREPAY_OFFERS = [
  { months: 6, discount: 0.05, label: '6 months upfront' },
  { months: 12, discount: 0.10, label: '12 months upfront' }
];

function money(n) { return '£' + n.toFixed(2); }

function prepayOffers(u) {
  return PREPAY_OFFERS.map(function (o) {
    var fullExVat = u.pcmExVat * o.months;
    var payExVat = fullExVat * (1 - o.discount);
    var payIncVat = payExVat * (1 + VAT_RATE);
    var saveExVat = fullExVat - payExVat;
    var saveIncVat = saveExVat * (1 + VAT_RATE);
    return {
      months: o.months, label: o.label, pct: Math.round(o.discount * 100),
      payExVat: payExVat, payIncVat: payIncVat, saveExVat: saveExVat, saveIncVat: saveIncVat
    };
  });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseBody(event) {
  var raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  var ctype = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (ctype.indexOf('application/json') !== -1) {
    return { data: JSON.parse(raw || '{}'), json: true };
  }
  var out = {}; new URLSearchParams(raw).forEach(function (v, k) { out[k] = v; });
  return { data: out, json: false };
}

/* Returns an async send(msg) using whichever provider is configured.
   msg = { from, to:[..], reply_to, subject, html, text } */
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

/* Add a consenting customer to the MailerLite marketing group.
   Best-effort: returns false (never throws) so a marketing failure can never
   stop the customer receiving their quote. Only runs when the customer ticked
   the opt-in box AND MailerLite is configured. */
async function subscribeToMailerLite(d) {
  var optedIn = d.marketing_opt_in === 'yes' || d.marketing_opt_in === 'on' ||
                d.marketing_opt_in === true || d.marketing_opt_in === '1';
  if (!optedIn) return false;
  var key = process.env.MAILERLITE_API_KEY;
  var group = process.env.MAILERLITE_GROUP_ID;
  if (!key) return false;

  var body = { email: String(d.email).trim(), fields: {} };
  if (d.name) body.fields.name = String(d.name).trim();
  if (group) body.groups = [String(group)];

  try {
    var r = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) { console.error('MailerLite ' + r.status + ': ' + (await r.text())); return false; }
    return true;
  } catch (err) {
    console.error('MailerLite subscribe failed:', err);
    return false;
  }
}

/* Booking from the quote email: the customer has just seen their price, so
   this is the moment they can commit. Only offered once online booking is
   switched on (BOOKING_LIVE=true in Netlify) - until then the quote email
   sticks to reply/call/WhatsApp. */
function bookingLive() {
  var v = String(process.env.BOOKING_LIVE || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  return v === 'true' || v === 'yes' || v === '1' || v === 'on';
}

/* How many units are free for this quote's size, across the customer's
   preferred site(s). Reads the same availability sheet the booking page
   uses. Returns null when unknown (sheet unset/unreachable) - fail soft. */
async function unitsFreeFor(d) {
  var url = process.env.AVAILABILITY_SHEET_CSV_URL;
  if (!url) return null;
  try {
    var r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    var rows = (await r.text()).split(/\r?\n/).map(function (l) {
      return l.split(',').map(function (c) { return c.replace(/^"|"$/g, '').trim().toLowerCase(); });
    });
    var head = rows[0], iSite = head.indexOf('site'), iSize = head.indexOf('size'), iFree = head.indexOf('units_free');
    if (iSite === -1 || iSize === -1 || iFree === -1) return null;
    var size = (d.container_size || '').toLowerCase();
    var pref = (d.preferred_site || '').toLowerCase();
    var sites = (pref === 'batley' || pref === 'liversedge') ? [pref]
              : (size === '8ft' ? ['batley'] : ['batley', 'liversedge']);
    var total = 0, found = false;
    rows.slice(1).forEach(function (row) {
      if (row[iSize] !== size || sites.indexOf(row[iSite]) === -1) return;
      var n = parseInt(row[iFree], 10);
      if (!isNaN(n)) { total += Math.max(0, n); found = true; }
    });
    return found ? total : null;
  } catch (e) { console.error(e); return null; }
}

/* Which booking panel the quote email should show:
   'book'  - bookable now, show the Book online button
   'later' - their move-in date is beyond the 3-day booking window
   'full'  - their size is sold out at their preferred site(s)
   'off'   - online booking not enabled */
async function bookingState(d) {
  if (!bookingUrl(d)) return 'off';
  if (d.move_in_date) {
    var picked = new Date(d.move_in_date + 'T12:00:00');
    var latest = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    latest.setHours(23, 59, 59, 999);
    if (!isNaN(picked.getTime()) && picked > latest) return 'later';
  }
  var free = await unitsFreeFor(d);
  if (free !== null && free <= 0) return 'full';
  return 'book';
}

function bookingUrl(d) {
  if (!bookingLive()) return null;
  var q = new URLSearchParams();
  q.set('size', d.container_size || '');
  var site = (d.preferred_site || '').toLowerCase();
  if (site === 'batley' || site === 'liversedge') q.set('site', site);
  if (d.name) q.set('name', String(d.name).slice(0, 100));
  if (d.email) q.set('email', String(d.email).slice(0, 100));
  if (d.phone) q.set('phone', String(d.phone).slice(0, 30));
  return SITE + '/book.html?' + q.toString();
}

function customerHtml(name, u, incVat, d, state) {
  var row = function (label, val) {
    return '<tr><td style="padding:6px 0;color:#5b5648;font-size:14px">' + esc(label) +
           '</td><td style="padding:6px 0;color:#22303a;font-size:14px;font-weight:600;text-align:right">' + esc(val) + '</td></tr>';
  };
  var extra = '';
  if (d.preferred_site) extra += row('Preferred site', d.preferred_site);
  if (d.move_in_date)   extra += row('Preferred move-in date', d.move_in_date);

  var offers = prepayOffers(u);
  var offerCards = offers.map(function (o, i) {
    var best = i === offers.length - 1;
    return '' +
      '<td width="50%" valign="top" style="padding:' + (i === 0 ? '0 8px 0 0' : '0 0 0 8px') + '">' +
        '<div style="border:2px solid ' + (best ? '#00A34A' : '#e4e1da') + ';border-radius:12px;padding:16px 14px;position:relative;' + (best ? 'background:#f0faf4' : '') + '">' +
          (best ? '<div style="position:absolute;top:-11px;left:14px;background:#00A34A;color:#fff;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px">Best value</div>' : '') +
          '<p style="margin:6px 0 2px;font-size:13px;color:#5b5648;font-weight:600">' + esc(o.label) + '</p>' +
          '<p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#1E4C6B">Save ' + o.pct + '%</p>' +
          '<p style="margin:0 0 2px;font-size:13px;color:#22303a">Pay ' + money(o.payIncVat) + ' <span style="color:#5b5648;font-weight:400">(inc. VAT)</span></p>' +
          '<p style="margin:0;font-size:12px;color:#008a3f;font-weight:700">You save ' + money(o.saveIncVat) + '</p>' +
        '</div>' +
      '</td>';
  }).join('');

  return '' +
  '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
    '<tr><td style="background:#ffffff;padding:22px 28px" align="left">' +
      '<img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="44" style="height:44px;display:block">' +
    '</td></tr>' +
    '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
    '<tr><td style="padding:28px">' +
      '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc(name) + ',</p>' +
      '<p style="margin:0 0 20px;font-size:15px;color:#5b5648;line-height:1.6">Great news - we have space ready for you. Here is your personalised quote, straight away and with no obligation.</p>' +
      '<div style="background:#f7f6f3;border:1px solid #e4e1da;border-radius:12px;padding:18px 20px;margin-bottom:20px">' +
        '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#008a3f;font-weight:700">Your quote</p>' +
        '<p style="margin:0 0 2px;font-size:18px;font-weight:800;color:#1E4C6B">' + esc(u.label) + '</p>' +
        '<p style="margin:0 0 12px;font-size:13px;color:#5b5648;font-weight:600">' + esc(u.sqft) + ' of floor space</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          row('Availability', u.avail) + extra +
          '<tr><td colspan="2" style="border-top:1px solid #e4e1da;padding-top:10px"></td></tr>' +
          row('Monthly rental', money(u.pcmExVat) + ' + VAT') +
          row('Including VAT', money(incVat) + ' per month') +
          row('Refundable deposit', money(u.deposit)) +
        '</table>' +
        '<p style="margin:12px 0 0;font-size:13px;color:#5b5648;line-height:1.5">Your deposit is refunded in full when you leave, provided the unit is left as it was found. This quote is valid for 30 days.</p>' +
      '</div>' +
      '<div style="background:#e9eff4;border-radius:12px;padding:14px 18px;margin-bottom:22px">' +
        '<p style="margin:0 0 3px;font-size:14px;color:#1E4C6B;font-weight:700">Flexible - no long-term contract</p>' +
        '<p style="margin:0;font-size:13px;color:#5b5648;line-height:1.5">Hire is rolling and monthly with a one-month minimum. Stay as long or as little as you like - and if you ever need to leave, it is just 14 days\' notice. You are never tied in.</p>' +
      '</div>' +
      '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1E4C6B;font-weight:700">Pay upfront and save</p>' +
      '<p style="margin:0 0 12px;font-size:14px;color:#5b5648;line-height:1.5">Lock in your rate and skip the monthly admin - the longer you pay upfront, the more you save.</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px"><tr>' + offerCards + '</tr></table>' +
      '<p style="margin:0 0 22px;font-size:13px;color:#5b5648;line-height:1.5">Fancy an upfront saving? You still only pay the deposit to book - just choose your payment preference when booking (or mention it when we confirm) and we\'ll reflect it in your first invoice.</p>' +
      '<p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1E4C6B;font-weight:700">Included with every unit</p>' +
      '<ul style="margin:0 0 20px;padding-left:18px;color:#5b5648;font-size:14px;line-height:1.7">' +
        '<li>High-quality padlock provided</li>' +
        '<li>24/7 CCTV with motion-sensing cameras</li>' +
        '<li>Mobile phone entry - open the gates from your phone</li>' +
        '<li>Round-the-clock support</li>' +
      '</ul>' +
      (state === 'book' ?
        '<div style="background:#f0faf4;border:2px solid #00A34A;border-radius:12px;padding:18px 20px;margin-bottom:18px;text-align:center">' +
          '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#008a3f;font-weight:800">Happy with your price?</p>' +
          '<p style="margin:0 0 14px;font-size:14px;color:#5b5648;line-height:1.5">Secure your unit right now - one online payment covers your refundable ' + money(u.deposit) + ' deposit plus your rent to the end of the month (pro-rata), and you\'re fully booked with nothing more to pay until the 1st.</p>' +
          '<a href="' + bookingUrl(d) + '" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:999px;font-size:16px">Book online now</a>' +
          '<p style="margin:14px 0 0;font-size:12px;color:#5b5648;line-height:1.6;text-align:left">Because availability is limited, online bookings can be made up to <strong>3 days in advance</strong>. Moving in within 7 days of the end of the month? Your first payment covers the following month too, so you\'re not invoiced again days later. Want to move in further ahead? Just reply to this email or call <a href="tel:+447375355233" style="color:#008a3f">07375 355233</a> and we\'ll see what we can arrange.</p>' +
        '</div>' : '') +
      (state === 'later' ?
        '<div style="background:#e9eff4;border:2px solid #1E4C6B;border-radius:12px;padding:18px 20px;margin-bottom:18px">' +
          '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1E4C6B;font-weight:800">Planning ahead?</p>' +
          '<p style="margin:0;font-size:14px;color:#22303a;line-height:1.6">Your preferred move-in date is more than 3 days away, and because availability is limited we only take firm bookings up to <strong>3 days before move-in</strong>. Don\'t worry - <strong>this quote is valid for 30 days</strong>. Reply to this email or call <a href="tel:+447375355233" style="color:#1E4C6B">07375 355233</a> nearer the time and we\'ll get you booked in.</p>' +
        '</div>' : '') +
      (state === 'full' ?
        '<div style="background:#fdf3e7;border:2px solid #d98324;border-radius:12px;padding:18px 20px;margin-bottom:18px">' +
          '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a4560a;font-weight:800">Currently fully booked</p>' +
          '<p style="margin:0;font-size:14px;color:#22303a;line-height:1.6">This size is in high demand and currently fully booked' + (d.preferred_site && d.preferred_site !== 'Either is fine' ? ' at ' + esc(d.preferred_site) : '') + ' - but units free up all the time. <strong>Reply to this email or call <a href="tel:+447375355233" style="color:#a4560a">07375 355233</a> to join the waiting list</strong> and we\'ll let you know the moment one becomes available. Your quote is valid for 30 days.</p>' +
        '</div>' : '') +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding:0 10px 10px 0"><a href="tel:+447375355233" style="display:inline-block;background:' + (state === 'book' ? '#1E4C6B' : '#00A34A') + ';color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px">Call to book: 07375 355233</a></td>' +
        '<td style="padding:0 0 10px 0"><a href="https://wa.me/447375355233?text=' + encodeURIComponent("Hi MB Storage, I've just received my quote and I'd like to go ahead.") + '" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px">WhatsApp us</a></td>' +
      '</tr></table>' +
      '<p style="margin:12px 0 0;font-size:14px;color:#5b5648;line-height:1.6">' + (state === 'full' ? 'Reply to this email, WhatsApp us or give us a call and we\'ll add you to the waiting list.' : (state === 'book' ? 'Spaces like this don\'t hang around long. Book online above, reply to this email, WhatsApp us or give us a call and we\'ll get you moved in - often the same day.' : 'Reply to this email, WhatsApp us or give us a call and we\'ll get you moved in - often the same day.')) + '</p>' +
    '</td></tr>' +
    '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">' +
      'MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; ' +
      '<a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; ' +
      '<a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a>' +
    '</td></tr>' +
  '</table></td></tr></table></div>';
}

function customerText(name, u, incVat, d, state) {
  var offers = prepayOffers(u);
  var offerLines = [];
  offers.forEach(function (o) {
    offerLines.push(o.label + ': SAVE ' + o.pct + '% - pay ' + money(o.payIncVat) + ' (inc. VAT), you save ' + money(o.saveIncVat));
  });

  var lines = [
    'Hi ' + name + ',', '',
    'Great news - we have space ready for you. Here is your personalised quote, straight away and with no obligation.', '',
    'YOUR QUOTE', '----------------------------------------',
    'Unit: ' + u.label,
    'Size: ' + u.sqft + ' of floor space',
    'Availability: ' + u.avail,
    (d.preferred_site ? 'Preferred site: ' + d.preferred_site : null),
    (d.move_in_date ? 'Preferred move-in date: ' + d.move_in_date : null), '',
    'Monthly rental: ' + money(u.pcmExVat) + ' + VAT per calendar month',
    '(' + money(incVat) + ' including VAT)', '',
    'Refundable deposit: ' + money(u.deposit),
    'Your deposit is refunded in full when you leave, provided the unit is left as it was found.',
    'This quote is valid for 30 days.', '',
    'FLEXIBLE - NO LONG-TERM CONTRACT', '----------------------------------------',
    'Hire is rolling and monthly with a one-month minimum. Stay as long or as little as you like, and if you ever need to leave it is just 14 days notice. You are never tied in.', '',
    'PAY UPFRONT AND SAVE', '----------------------------------------',
    'Lock in your rate and skip the monthly admin - the longer you pay upfront, the more you save.',
  ].concat(offerLines).concat([
    'You still only pay the deposit to book - just choose your payment preference when booking (or mention it when we confirm) and we\'ll reflect it in your first invoice.',
  ]).concat([
    '', 'INCLUDED WITH EVERY UNIT', '----------------------------------------',
    '- High-quality padlock provided',
    '- 24/7 CCTV with motion-sensing cameras',
    '- Mobile phone entry - open the gates from your phone',
    '- Round-the-clock support', '',
    (state === 'book' ? 'HAPPY WITH YOUR PRICE? BOOK ONLINE NOW' : null),
    (state === 'book' ? '----------------------------------------' : null),
    (state === 'book' ? 'Secure your unit right now - one online payment covers your refundable ' + money(u.deposit) + ' deposit plus your rent to the end of the month (pro-rata), and you\'re fully booked with nothing more to pay until the 1st:' : null),
    (state === 'book' ? bookingUrl(d) : null),
    (state === 'book' ? '' : null),
    (state === 'book' ? 'Please note: because availability is limited, online bookings can be made up to 3 days in advance. Moving in within 7 days of the end of the month? Your first payment covers the following month too, so you\'re not invoiced again days later. Want to move in further ahead? Reply to this email or call 07375 355233 and we\'ll see what we can arrange.' : null),
    (state === 'book' ? '' : null),
    (state === 'later' ? 'PLANNING AHEAD?' : null),
    (state === 'later' ? '----------------------------------------' : null),
    (state === 'later' ? 'Your preferred move-in date is more than 3 days away, and because availability is limited we only take firm bookings up to 3 days before move-in. Don\'t worry - this quote is valid for 30 days. Reply to this email or call 07375 355233 nearer the time and we\'ll get you booked in.' : null),
    (state === 'later' ? '' : null),
    (state === 'full' ? 'CURRENTLY FULLY BOOKED' : null),
    (state === 'full' ? '----------------------------------------' : null),
    (state === 'full' ? 'This size is in high demand and currently fully booked - but units free up all the time. Reply to this email or call 07375 355233 to join the waiting list and we\'ll let you know the moment one becomes available. Your quote is valid for 30 days.' : null),
    (state === 'full' ? '' : null),
    (state === 'full'
      ? 'Reply to this email, WhatsApp us on 07375 355233 (https://wa.me/447375355233) or give us a call and we\'ll add you to the waiting list.'
      : "Spaces like this don't hang around long. Reply to this email, WhatsApp us on 07375 355233 (https://wa.me/447375355233) or give us a call and we'll get you moved in - often the same day."), '',
    'Kind regards,', 'MB Storage',
    '07375 355233 | WhatsApp: wa.me/447375355233 | info@mbstorage.co.uk | mbstorage.co.uk'
  ]);
  return lines.filter(function (l) { return l !== null; }).join('\n');
}

function notifyHtml(u, d) {
  var row = function (k, v) {
    return '<tr><td style="padding:5px 12px 5px 0;color:#5b5648;font-size:14px">' + esc(k) +
           '</td><td style="padding:5px 0;color:#22303a;font-size:14px;font-weight:600">' + esc(v || ' - ') + '</td></tr>';
  };
  return '<div style="font-family:Segoe UI,Arial,sans-serif;color:#22303a">' +
    '<h2 style="color:#1E4C6B">New quote / booking request</h2>' +
    '<table role="presentation" cellpadding="0" cellspacing="0">' +
      row('Name', d.name) + row('Email', d.email) + row('Phone', d.phone) +
      row('Container', u.label + ' (' + u.sqft + ')') +
      row('Quote', money(u.pcmExVat) + ' + VAT pcm, deposit ' + money(u.deposit)) +
      row('Preferred site', d.preferred_site) +
      row('Move-in date', d.move_in_date) +
      row('Storing', d.storing) +
      row('Marketing opt-in', (d.marketing_opt_in === 'yes' || d.marketing_opt_in === 'on') ? 'Yes - added to mailing list' : 'No') +
    '</table></div>';
}

function json(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  var parsed;
  try { parsed = parseBody(event); } catch (e) { return json(400, { ok: false, error: 'Bad request' }); }
  var d = parsed.data || {};
  var wantsJson = parsed.json;
  var redirect = function () { return { statusCode: 303, headers: { Location: '/thank-you.html' }, body: '' }; };
  var fail = function (code, msg) { return wantsJson ? json(code, { ok: false, error: msg }) : redirect(); };

  // Honeypot - silently succeed for bots
  if (d._honey || d.company) return wantsJson ? json(200, { ok: true }) : redirect();

  var u = UNITS[d.container_size];
  if (!u) return fail(400, 'Please choose a container size.');
  if (!d.email || String(d.email).indexOf('@') === -1) return fail(400, 'A valid email is required.');
  if (!d.preferred_site || !String(d.preferred_site).trim()) return fail(400, 'Please choose your preferred site.');
  if (!d.storing || !String(d.storing).trim()) return fail(400, 'Please tell us what you\'ll be storing.');
  if (!process.env.RESEND_API_KEY && !process.env.MAILGUN_API_KEY) return fail(500, 'Email service not configured.');

  var name = (d.name || 'there').toString().trim() || 'there';
  var incVat = u.pcmExVat * (1 + VAT_RATE);

  // Visible in Netlify function logs - confirms whether the booking flag reached us
  console.log('BOOKING_LIVE raw value:', JSON.stringify(process.env.BOOKING_LIVE), '-> booking button:', bookingLive() ? 'ON' : 'OFF');

  var state = await bookingState(d);
  console.log('Quote email booking panel state:', state);

  var send = makeSender();

  try {
    // 1) Customer quote
    await send({
      from: FROM, to: [d.email], reply_to: TO,
      subject: 'Your MB Storage quote - save up to 10% paying upfront',
      html: customerHtml(name, u, incVat, d, state),
      text: customerText(name, u, incVat, d, state)
    });
    // 2) Internal notification
    await send({
      from: FROM, to: [TO], reply_to: d.email,
      subject: 'New quote/booking request - ' + name,
      html: notifyHtml(u, d)
    });
  } catch (err) {
    console.error(err);
    return fail(502, 'Could not send email. Please try again.');
  }

  // 3) Marketing sign-up (best-effort - never blocks the quote above)
  try { await subscribeToMailerLite(d); } catch (e) { console.error(e); }

  // 4) Log the quote for follow-up (best-effort) - powers the daily
  //    warm-leads digest and the day-2/day-7 follow-up emails
  try {
    var blobs = require('./lib/blobs');
    var key = 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await blobs.store('quote-log').setJSON(key, {
      ts: Date.now(),
      name: name,
      email: String(d.email).trim().toLowerCase(),
      phone: d.phone || '',
      size: d.container_size,
      sizeLabel: u.label,
      site: d.preferred_site || '',
      storing: d.storing || '',
      fu2: false, fu7: false
    });
  } catch (e) { console.error('Quote log failed:', e); }

  return wantsJson ? json(200, { ok: true }) : redirect();
};
