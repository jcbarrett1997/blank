/*
 * MB Storage — instant quote handler (Netlify Function)
 *
 * Receives the quote form, calculates the price SERVER-SIDE (so pricing is
 * never exposed to the browser), then sends two emails via Mailgun:
 *   1. the customer's personalised quote (from @mbstorage.co.uk)
 *   2. a notification to the MB Storage inbox
 *
 * Environment variables (set in the Netlify dashboard — never in the repo):
 *   MAILGUN_API_KEY   required — your Mailgun sending API key
 *   MAILGUN_DOMAIN    required — the Mailgun domain, e.g. "mbstorage.co.uk"
 *   MAILGUN_API_BASE  optional — "https://api.eu.mailgun.net" for the EU region
 *                     (default is the US region "https://api.mailgun.net")
 *   MAIL_FROM         e.g. "MB Storage <quotes@mbstorage.co.uk>"
 *   MAIL_TO           where enquiries are sent, e.g. "info@mbstorage.co.uk"
 *   SITE_URL          e.g. "https://www.mbstorage.co.uk" (used for the logo)
 */

var VAT_RATE = 0.20;
var UNITS = {
  '20ft': { label: '20ft × 8ft storage container', pcmExVat: 160.00, deposit: 150.00, avail: 'Available at all our sites' },
  '8ft':  { label: '8ft × 6ft 6in storage container', pcmExVat: 82.50, deposit: 75.00, avail: 'Available at our Batley site only' }
};

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');

function money(n) { return '£' + n.toFixed(2); }
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

function customerHtml(name, u, incVat, d) {
  var row = function (label, val) {
    return '<tr><td style="padding:6px 0;color:#5b5648;font-size:14px">' + esc(label) +
           '</td><td style="padding:6px 0;color:#22303a;font-size:14px;font-weight:600;text-align:right">' + esc(val) + '</td></tr>';
  };
  var extra = '';
  if (d.preferred_site) extra += row('Preferred site', d.preferred_site);
  if (d.move_in_date)   extra += row('Preferred move-in date', d.move_in_date);
  return '' +
  '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
    '<tr><td style="background:#1E4C6B;padding:22px 28px" align="left">' +
      '<img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="40" style="height:40px;display:block">' +
    '</td></tr>' +
    '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
    '<tr><td style="padding:28px">' +
      '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc(name) + ',</p>' +
      '<p style="margin:0 0 20px;font-size:15px;color:#5b5648;line-height:1.6">Thank you for your enquiry — here is your instant quote from MB Storage.</p>' +
      '<div style="background:#f7f6f3;border:1px solid #e4e1da;border-radius:12px;padding:18px 20px;margin-bottom:20px">' +
        '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#008a3f;font-weight:700">Your quote</p>' +
        '<p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#1E4C6B">' + esc(u.label) + '</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          row('Availability', u.avail) + extra +
          '<tr><td colspan="2" style="border-top:1px solid #e4e1da;padding-top:10px"></td></tr>' +
          row('Monthly rental', money(u.pcmExVat) + ' + VAT') +
          row('Including VAT', money(incVat) + ' per month') +
          row('Refundable deposit', money(u.deposit)) +
        '</table>' +
        '<p style="margin:12px 0 0;font-size:13px;color:#5b5648;line-height:1.5">Your deposit is refunded in full when you leave, provided the unit is left as it was found.</p>' +
      '</div>' +
      '<p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1E4C6B;font-weight:700">Included with every unit</p>' +
      '<ul style="margin:0 0 20px;padding-left:18px;color:#5b5648;font-size:14px;line-height:1.7">' +
        '<li>High-quality padlock provided</li>' +
        '<li>24/7 CCTV with motion-sensing cameras</li>' +
        '<li>Mobile phone entry &mdash; open the gates from your phone</li>' +
        '<li>Round-the-clock support</li>' +
      '</ul>' +
      '<a href="tel:+447375355233" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px">Call to book: 07375 355233</a>' +
      '<p style="margin:22px 0 0;font-size:14px;color:#5b5648;line-height:1.6">Ready to go ahead? Just reply to this email or call us and we\'ll arrange your move-in — often the same day.</p>' +
    '</td></tr>' +
    '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">' +
      'MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; ' +
      '<a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; ' +
      '<a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a>' +
    '</td></tr>' +
  '</table></td></tr></table></div>';
}

function customerText(name, u, incVat, d) {
  var lines = [
    'Hi ' + name + ',', '',
    'Thank you for your enquiry — here is your instant quote from MB Storage.', '',
    'YOUR QUOTE', '----------------------------------------',
    'Unit: ' + u.label,
    'Availability: ' + u.avail,
    (d.preferred_site ? 'Preferred site: ' + d.preferred_site : null),
    (d.move_in_date ? 'Preferred move-in date: ' + d.move_in_date : null), '',
    'Monthly rental: ' + money(u.pcmExVat) + ' + VAT per calendar month',
    '(' + money(incVat) + ' including VAT)', '',
    'Refundable deposit: ' + money(u.deposit),
    'Your deposit is refunded in full when you leave, provided the unit is left as it was found.', '',
    'INCLUDED WITH EVERY UNIT', '----------------------------------------',
    '- High-quality padlock provided',
    '- 24/7 CCTV with motion-sensing cameras',
    '- Mobile phone entry — open the gates from your phone',
    '- Round-the-clock support', '',
    'To book, reply to this email or call 07375 355233.', '',
    'Kind regards,', 'MB Storage',
    '07375 355233 | info@mbstorage.co.uk | mbstorage.co.uk'
  ];
  return lines.filter(function (l) { return l !== null; }).join('\n');
}

function notifyHtml(u, d) {
  var row = function (k, v) {
    return '<tr><td style="padding:5px 12px 5px 0;color:#5b5648;font-size:14px">' + esc(k) +
           '</td><td style="padding:5px 0;color:#22303a;font-size:14px;font-weight:600">' + esc(v || '—') + '</td></tr>';
  };
  return '<div style="font-family:Segoe UI,Arial,sans-serif;color:#22303a">' +
    '<h2 style="color:#1E4C6B">New quote / booking request</h2>' +
    '<table role="presentation" cellpadding="0" cellspacing="0">' +
      row('Name', d.name) + row('Email', d.email) + row('Phone', d.phone) +
      row('Container', u.label) +
      row('Quote', money(u.pcmExVat) + ' + VAT pcm, deposit ' + money(u.deposit)) +
      row('Preferred site', d.preferred_site) +
      row('Move-in date', d.move_in_date) +
      row('Storing', d.storing) +
      row('Wants to book', d.booking_request) +
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

  // Honeypot — silently succeed for bots
  if (d._honey || d.company) return wantsJson ? json(200, { ok: true }) : redirect();

  var u = UNITS[d.container_size];
  if (!u) return fail(400, 'Please choose a container size.');
  if (!d.email || String(d.email).indexOf('@') === -1) return fail(400, 'A valid email is required.');
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return fail(500, 'Email service not configured.');

  var name = (d.name || 'there').toString().trim() || 'there';
  var incVat = u.pcmExVat * (1 + VAT_RATE);

  async function send(msg) {
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
  }

  try {
    // 1) Customer quote
    await send({
      from: FROM, to: [d.email], reply_to: TO,
      subject: 'Your MB Storage quote',
      html: customerHtml(name, u, incVat, d),
      text: customerText(name, u, incVat, d)
    });
    // 2) Internal notification
    await send({
      from: FROM, to: [TO], reply_to: d.email,
      subject: 'New quote/booking request — ' + name,
      html: notifyHtml(u, d)
    });
  } catch (err) {
    console.error(err);
    return fail(502, 'Could not send email. Please try again.');
  }

  return wantsJson ? json(200, { ok: true }) : redirect();
};
