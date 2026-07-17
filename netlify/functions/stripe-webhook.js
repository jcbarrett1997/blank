/*
 * MB Storage - Stripe payment webhook (Netlify Function)
 *
 * Stripe calls this endpoint when a Checkout payment succeeds. We verify the
 * call is genuinely from Stripe (HMAC signature), then send:
 *   1. a branded booking confirmation to the customer
 *   2. an urgent "deposit paid" notification to the MB Storage inbox
 *
 * Because Batley and Liversedge are separate Stripe accounts, BOTH webhook
 * signing secrets are configured and each incoming event is verified against
 * either. Add this endpoint in each Stripe dashboard:
 *   https://www.mbstorage.co.uk/.netlify/functions/stripe-webhook
 *   (event: checkout.session.completed)
 *
 *   STRIPE_WEBHOOK_SECRET_BATLEY
 *   STRIPE_WEBHOOK_SECRET_LIVERSEDGE
 *
 * Email uses the same provider config as quote.js (Mailgun or Resend).
 */

var crypto = require('crypto');

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

/* Verify Stripe's signature header against a signing secret. */
function verifySig(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  var parts = {};
  sigHeader.split(',').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) {
      var k = kv.slice(0, i);
      (parts[k] = parts[k] || []).push(kv.slice(i + 1));
    }
  });
  var t = (parts.t || [])[0];
  var sigs = parts.v1 || [];
  if (!t || !sigs.length) return false;
  // Reject events signed more than 5 minutes ago (replay protection)
  if (Math.abs(Date.now() / 1000 - parseInt(t, 10)) > 300) return false;
  var expected = crypto.createHmac('sha256', secret).update(t + '.' + payload, 'utf8').digest('hex');
  return sigs.some(function (s) {
    try {
      return s.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex'));
    } catch (e) { return false; }
  });
}

function money(pence) { return '£' + (pence / 100).toFixed(2); }

function customerHtml(name, m, amount) {
  var row = function (label, val) {
    return '<tr><td style="padding:6px 0;color:#5b5648;font-size:14px">' + esc(label) +
           '</td><td style="padding:6px 0;color:#22303a;font-size:14px;font-weight:600;text-align:right">' + esc(val) + '</td></tr>';
  };
  var extra = '';
  if (m.move_in_date) extra += row('Preferred move-in date', m.move_in_date);

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
      '<p style="margin:0 0 20px;font-size:15px;color:#5b5648;line-height:1.6"><strong style="color:#008a3f">Your deposit is paid and your booking is in.</strong> Here\'s what we have - we\'ll be in touch very shortly (usually the same day) to confirm your move-in and get your padlock and phone access sorted.</p>' +
      '<div style="background:#f7f6f3;border:1px solid #e4e1da;border-radius:12px;padding:18px 20px;margin-bottom:20px">' +
        '<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#008a3f;font-weight:700">Your booking</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          row('Unit', m.unitLabel || (m.container_size + ' container')) +
          row('Site', m.site || '-') + extra +
          '<tr><td colspan="2" style="border-top:1px solid #e4e1da;padding-top:10px"></td></tr>' +
          row('Deposit paid', amount) +
        '</table>' +
        '<p style="margin:12px 0 0;font-size:13px;color:#5b5648;line-height:1.5">Your deposit is refunded in full when you leave, provided the unit is left as it was found. Your monthly rental will be invoiced separately.</p>' +
      '</div>' +
      '<p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1E4C6B;font-weight:700">What happens next</p>' +
      '<ul style="margin:0 0 20px;padding-left:18px;color:#5b5648;font-size:14px;line-height:1.7">' +
        '<li>We\'ll call or email to confirm your move-in date and unit</li>' +
        '<li>Your first invoice follows by email</li>' +
        '<li>You\'ll get your high-quality padlock and mobile phone gate access</li>' +
        '<li>Move in - often the same day</li>' +
      '</ul>' +
      '<a href="tel:+447375355233" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px">Questions? Call 07375 355233</a>' +
    '</td></tr>' +
    '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">' +
      'MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; ' +
      '<a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; ' +
      '<a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a>' +
    '</td></tr>' +
  '</table></td></tr></table></div>';
}

function customerText(name, m, amount) {
  return [
    'Hi ' + name + ',', '',
    'Your deposit is paid and your booking is in. We\'ll be in touch very shortly (usually the same day) to confirm your move-in.', '',
    'YOUR BOOKING', '----------------------------------------',
    'Unit: ' + (m.unitLabel || m.container_size),
    'Site: ' + (m.site || '-'),
    (m.move_in_date ? 'Preferred move-in date: ' + m.move_in_date : null),
    'Deposit paid: ' + amount, '',
    'Your deposit is refunded in full when you leave, provided the unit is left as it was found. Your monthly rental will be invoiced separately.', '',
    'WHAT HAPPENS NEXT', '----------------------------------------',
    '- We\'ll call or email to confirm your move-in date and unit',
    '- Your first invoice follows by email',
    '- You\'ll get your padlock and mobile phone gate access',
    '- Move in - often the same day', '',
    'Questions? Call 07375 355233.', '',
    'Kind regards,', 'MB Storage',
    '07375 355233 | info@mbstorage.co.uk | mbstorage.co.uk'
  ].filter(function (l) { return l !== null; }).join('\n');
}

function notifyHtml(m, email, amount) {
  var row = function (k, v) {
    return '<tr><td style="padding:5px 12px 5px 0;color:#5b5648;font-size:14px">' + esc(k) +
           '</td><td style="padding:5px 0;color:#22303a;font-size:14px;font-weight:600">' + esc(v || ' - ') + '</td></tr>';
  };
  return '<div style="font-family:Segoe UI,Arial,sans-serif;color:#22303a">' +
    '<h2 style="color:#008a3f">NEW BOOKING - deposit paid (' + esc(amount) + ')</h2>' +
    '<p style="color:#b3261e;font-weight:700">Action needed: confirm move-in and send the first invoice.</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0">' +
      row('Name', m.name) + row('Email', email) + row('Phone', m.phone) +
      row('Unit', m.unitLabel || m.container_size) +
      row('Site', m.site) +
      row('Move-in date', m.move_in_date) +
      row('Storing', m.storing) +
      row('Deposit paid', amount) +
      row('Agreed to T&Cs', m.terms_agreed) +
    '</table></div>';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  var payload = event.body || '';
  if (event.isBase64Encoded) payload = Buffer.from(payload, 'base64').toString('utf8');
  var sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  var ok = verifySig(payload, sig, process.env.STRIPE_WEBHOOK_SECRET_BATLEY) ||
           verifySig(payload, sig, process.env.STRIPE_WEBHOOK_SECRET_LIVERSEDGE);
  if (!ok) return { statusCode: 400, body: 'Invalid signature' };

  var evt;
  try { evt = JSON.parse(payload); } catch (e) { return { statusCode: 400, body: 'Bad payload' }; }
  if (evt.type !== 'checkout.session.completed') return { statusCode: 200, body: 'Ignored' };

  var s = evt.data && evt.data.object ? evt.data.object : {};
  if (s.payment_status && s.payment_status !== 'paid') return { statusCode: 200, body: 'Not paid yet' };

  var m = s.metadata || {};
  var email = (s.customer_details && s.customer_details.email) || s.customer_email;
  var name = (m.name || 'there').trim() || 'there';
  var amount = money(s.amount_total || 0);
  m.unitLabel = m.container_size === '20ft' ? '20ft × 8ft storage container'
              : m.container_size === '8ft' ? '8ft × 6ft 6in storage container' : m.container_size;

  var send = makeSender();
  try {
    if (email) {
      await send({
        from: FROM, to: [email], reply_to: TO,
        subject: 'Booking confirmed - your MB Storage deposit is paid',
        html: customerHtml(name, m, amount),
        text: customerText(name, m, amount)
      });
    }
    await send({
      from: FROM, to: [TO], reply_to: email || TO,
      subject: 'NEW BOOKING - deposit paid - ' + name + ' (' + (m.site || '?') + ')',
      html: notifyHtml(m, email, amount)
    });
  } catch (err) {
    // Log but still return 200: payment is real regardless of email hiccups,
    // and a non-2xx would make Stripe retry and double-send anything that DID work.
    console.error('Booking email failed:', err);
  }

  return { statusCode: 200, body: 'OK' };
};
