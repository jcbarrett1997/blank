/*
 * MB Storage - contact form handler (Netlify Function)
 *
 * Sends the message to the MB Storage inbox and a branded acknowledgement to
 * the customer, both from a verified @mbstorage.co.uk sender.
 *
 * Works with either provider (set whichever variables in Netlify), same as the
 * quote function:
 *   Mailgun: MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_API_BASE (optional)
 *   Resend:  RESEND_API_KEY
 *   Shared:  MAIL_FROM, MAIL_TO, SITE_URL
 *
 * Spam protection: Cloudflare Turnstile (free). The widget on the page sets
 * a cf-turnstile-response field, which is checked against Cloudflare here -
 * see SETUP-CAPTCHA.md for how to get TURNSTILE_SECRET_KEY. If it's not set,
 * this check is skipped (fails soft) rather than breaking the form.
 */

async function verifyTurnstile(token, ip) {
  var secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured yet - don't block real customers
  if (!token) return false;
  try {
    var form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    var r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    var json = await r.json().catch(function () { return {}; });
    return !!json.success;
  } catch (e) {
    console.error('Turnstile verification failed:', e);
    return false;
  }
}

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

function parseBody(event) {
  var raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  var ctype = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (ctype.indexOf('application/json') !== -1) return { data: JSON.parse(raw || '{}'), json: true };
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

function ackHtml(name, message) {
  return '' +
  '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
    '<tr><td style="background:#ffffff;padding:22px 28px">' +
      '<img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="44" style="height:44px;display:block">' +
    '</td></tr>' +
    '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
    '<tr><td style="padding:28px">' +
      '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc(name) + ',</p>' +
      '<p style="margin:0 0 18px;font-size:15px;color:#5b5648;line-height:1.6">Thanks for getting in touch with MB Storage - we\'ve received your message and will get back to you shortly. If it\'s urgent, just give us a call on <a href="tel:+447375355233" style="color:#008a3f">07375 355233</a>.</p>' +
      '<div style="background:#f7f6f3;border:1px solid #e4e1da;border-radius:12px;padding:16px 18px;margin-bottom:8px">' +
        '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#008a3f;font-weight:700">Your message</p>' +
        '<p style="margin:0;font-size:14px;color:#22303a;line-height:1.6">' + nl2br(message) + '</p>' +
      '</div>' +
    '</td></tr>' +
    '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">' +
      'MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; ' +
      '<a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; ' +
      '<a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a>' +
    '</td></tr>' +
  '</table></td></tr></table></div>';
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

  if (d._honey || d.company) return wantsJson ? json(200, { ok: true }) : redirect();
  var clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
  var human = await verifyTurnstile(d['cf-turnstile-response'], clientIp);
  if (!human) return fail(400, 'Please try again - our spam check didn\'t recognise that submission.');
  if (!d.email || String(d.email).indexOf('@') === -1) return fail(400, 'A valid email is required.');
  if (!d.phone || !String(d.phone).trim()) return fail(400, 'A phone number is required.');
  if (!d.message || !String(d.message).trim()) return fail(400, 'Please enter a message.');
  if (!process.env.RESEND_API_KEY && !process.env.MAILGUN_API_KEY) return fail(500, 'Email service not configured.');

  var name = (d.name || 'there').toString().trim() || 'there';
  var send = makeSender();

  try {
    // Notify MB Storage
    await send({
      from: FROM, to: [TO], reply_to: d.email,
      subject: 'New contact message - ' + name,
      html: '<div style="font-family:Segoe UI,Arial,sans-serif;color:#22303a">' +
            '<h2 style="color:#1E4C6B">New contact message</h2>' +
            '<p><strong>Name:</strong> ' + esc(name) + '<br>' +
            '<strong>Email:</strong> ' + esc(d.email) + '<br>' +
            '<strong>Phone:</strong> ' + esc(d.phone) + '</p>' +
            '<p><strong>Message:</strong><br>' + nl2br(d.message) + '</p></div>'
    });
    // Acknowledge the customer
    await send({
      from: FROM, to: [d.email], reply_to: TO,
      subject: 'Thanks for contacting MB Storage',
      html: ackHtml(name, d.message)
    });
  } catch (err) {
    console.error(err);
    return fail(502, 'Could not send your message. Please try again.');
  }

  return wantsJson ? json(200, { ok: true }) : redirect();
};
