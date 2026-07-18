/*
 * MB Storage - daily quote follow-up (scheduled - see netlify.toml).
 *
 * Works from the quote log that quote.js writes:
 *  - ~2 days after a quote with no booking: friendly follow-up email #1
 *  - ~7 days after, still no booking: one final follow-up email, then done
 *  - a daily "warm leads" digest to MB Storage listing everyone nudged
 *    today, each with a one-tap WhatsApp link (pre-written message) and
 *    call link, so the personal touch takes seconds
 *
 * Customers who book (card or upfront request) get a "booked-" marker and
 * are left alone. Quotes older than 35 days are cleaned out of the log.
 * No configuration needed beyond what already exists; optional:
 *
 *   DIGEST_FROM_NAME  the first name used in the pre-written WhatsApp
 *                     message ("it's James from MB Storage") - defaults
 *                     to just "MB Storage"
 */

var blobs = require('./lib/blobs');

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');
var DAY = 24 * 60 * 60 * 1000;

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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bookingLive() {
  var v = String(process.env.BOOKING_LIVE || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  return v === 'true' || v === 'yes' || v === '1' || v === 'on';
}

function bookingUrl(q) {
  if (!bookingLive()) return null;
  var p = new URLSearchParams();
  p.set('size', q.size || '');
  var site = (q.site || '').toLowerCase();
  if (site === 'batley' || site === 'liversedge') p.set('site', site);
  if (q.name) p.set('name', q.name);
  if (q.email) p.set('email', q.email);
  if (q.phone) p.set('phone', q.phone);
  return SITE + '/book.html?' + p.toString();
}

/* "07123 456789" / "+44 7123..." -> "447123456789" for wa.me links */
function waPhone(p) {
  var digits = String(p || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.indexOf('440') === 0) digits = '44' + digits.slice(3);
  else if (digits.indexOf('0') === 0) digits = '44' + digits.slice(1);
  else if (digits.indexOf('44') !== 0) digits = '44' + digits;
  return digits;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function followUpEmail(q, isFinal) {
  var book = bookingUrl(q);
  var btn = book
    ? '<div style="text-align:center;margin:18px 0"><a href="' + book + '" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;font-size:15px">Book online now</a></div>'
    : '';
  var lead = isFinal
    ? 'Just one last note from us - your quote for the <strong>' + esc(q.sizeLabel || q.size + ' container') + '</strong> is still valid, but units are filling up and we\'d hate for you to miss out. If storage is still on your list, now\'s a great time.'
    : 'A couple of days ago we sent your personalised quote for the <strong>' + esc(q.sizeLabel || q.size + ' container') + '</strong> - just checking it reached you and seeing if you have any questions. It\'s valid for 30 days, so there\'s no pressure.';
  var close = isFinal
    ? 'We won\'t email you about this quote again - but we\'re here whenever you\'re ready. Just reply, book online or give us a call.'
    : 'Reply to this email with any questions at all - sizes, access, moving in - we\'re happy to help.';

  return {
    subject: isFinal
      ? 'Last one from us - your MB Storage quote is still here'
      : 'Still thinking it over? Your MB Storage quote is safe',
    html:
      '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
        '<tr><td style="background:#ffffff;padding:22px 28px" align="left"><img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="44" style="height:44px;display:block"></td></tr>' +
        '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
        '<tr><td style="padding:28px">' +
          '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc(firstName(q.name)) + ',</p>' +
          '<p style="margin:0 0 16px;font-size:15px;color:#5b5648;line-height:1.6">' + lead + '</p>' +
          btn +
          '<p style="margin:0 0 16px;font-size:14px;color:#5b5648;line-height:1.6">' + close + '</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
            '<td style="padding:0 10px 0 0"><a href="tel:+447375355233" style="display:inline-block;background:#1E4C6B;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px;font-size:14px">Call 07375 355233</a></td>' +
            '<td><a href="https://wa.me/447375355233?text=' + encodeURIComponent('Hi MB Storage, I had a quote from you recently and have a question.') + '" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px;font-size:14px">WhatsApp us</a></td>' +
          '</tr></table>' +
          '<p style="margin:18px 0 0;font-size:12px;color:#9a9384;line-height:1.5">Don\'t want reminders about this quote? Just reply and say so - no problem at all.</p>' +
        '</td></tr>' +
        '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; <a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; <a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a></td></tr>' +
      '</table></td></tr></table></div>',
    text: [
      'Hi ' + firstName(q.name) + ',', '',
      lead.replace(/<[^>]+>/g, ''), '',
      (book ? 'Book online: ' + book : null), (book ? '' : null),
      close, '',
      'Call 07375 355233 | WhatsApp: wa.me/447375355233 | reply to this email', '',
      "Don't want reminders about this quote? Just reply and say so.", '',
      'Kind regards,', 'MB Storage'
    ].filter(function (l) { return l !== null; }).join('\n')
  };
}

function digestRow(q, label) {
  var wa = waPhone(q.phone);
  var fromName = process.env.DIGEST_FROM_NAME || '';
  var msg = 'Hi ' + firstName(q.name) + ', it\'s ' + (fromName ? fromName + ' from ' : '') + 'MB Storage' +
    ' - just checking you got your quote for the ' + (q.sizeLabel || q.size + ' container') +
    '? Happy to help with any questions.';
  return '<tr>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #e4e1da;font-size:14px"><strong>' + esc(q.name) + '</strong>' + (label ? '<br><span style="color:#a4560a;font-size:12px">' + label + '</span>' : '') + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #e4e1da;font-size:13px;color:#5b5648">' + esc(q.sizeLabel || q.size) + '<br>' + esc(q.site || 'either site') + (q.storing ? '<br><em>' + esc(String(q.storing).slice(0, 60)) + '</em>' : '') + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #e4e1da;font-size:13px;white-space:nowrap">' +
      (wa ? '<a href="https://wa.me/' + wa + '?text=' + encodeURIComponent(msg) + '" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:700;padding:7px 12px;border-radius:999px;font-size:12px;margin-bottom:4px">WhatsApp</a><br>' : '') +
      (q.phone ? '<a href="tel:' + esc(q.phone) + '" style="color:#1E4C6B">' + esc(q.phone) + '</a><br>' : '') +
      '<a href="mailto:' + esc(q.email) + '" style="color:#1E4C6B;font-size:12px">' + esc(q.email) + '</a>' +
    '</td></tr>';
}

exports.handler = async function () {
  if (!process.env.MAILGUN_API_KEY && !process.env.RESEND_API_KEY) {
    return { statusCode: 200, body: 'email not configured' };
  }
  var store = blobs.store('quote-log');
  var listing;
  try { listing = await store.list(); } catch (e) {
    console.log('quote-followup: blobs unavailable - ' + e.message);
    return { statusCode: 200, body: 'blobs unavailable' };
  }
  var keys = (listing.blobs || []).map(function (b) { return b.key; });
  var now = Date.now();
  var send = makeSender();

  // Booked emails (with their booking time)
  var booked = {};
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('booked-') === 0) {
      var bm = await store.get(keys[i], { type: 'json' });
      booked[keys[i].slice(7)] = (bm && bm.ts) || 0;
      if (bm && bm.ts && now - bm.ts > 60 * DAY) await store.delete(keys[i]);
    }
  }

  var nudged2 = [], nudged7 = [];

  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    if (key.indexOf('q-') !== 0) continue;
    var q = await store.get(key, { type: 'json' });
    if (!q || !q.ts) { await store.delete(key); continue; }
    var age = now - q.ts;

    if (age > 35 * DAY) { await store.delete(key); continue; }

    // Booked since quoting? Leave them alone for good.
    if (q.email && booked[q.email] && booked[q.email] >= q.ts) { await store.delete(key); continue; }

    try {
      if (age >= 7 * DAY && !q.fu7) {
        if (q.email) {
          var e7 = followUpEmail(q, true);
          await send({ from: FROM, to: [q.email], reply_to: TO, subject: e7.subject, html: e7.html, text: e7.text });
        }
        q.fu7 = true; q.fu2 = true;
        await store.setJSON(key, q);
        nudged7.push(q);
      } else if (age >= 2 * DAY && !q.fu2) {
        if (q.email) {
          var e2 = followUpEmail(q, false);
          await send({ from: FROM, to: [q.email], reply_to: TO, subject: e2.subject, html: e2.html, text: e2.text });
        }
        q.fu2 = true;
        await store.setJSON(key, q);
        nudged2.push(q);
      }
    } catch (err) {
      console.error('Follow-up failed for ' + (q.email || key) + ':', err.message);
    }
  }

  if (nudged2.length || nudged7.length) {
    var html = '<div style="font-family:Segoe UI,Arial,sans-serif;color:#22303a">' +
      '<h2 style="color:#1E4C6B">Warm leads - quotes that haven\'t booked yet</h2>' +
      '<p style="font-size:14px;color:#5b5648">These customers were sent an automatic follow-up email today. A personal WhatsApp on top works wonders - the message is pre-written, just tap and send (edit it first if you like).</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
      nudged2.map(function (q) { return digestRow(q, ''); }).join('') +
      nudged7.map(function (q) { return digestRow(q, 'FINAL nudge - last automatic email sent'); }).join('') +
      '</table>' +
      '<p style="font-size:12px;color:#9a9384;margin-top:14px">Customers disappear from these digests when they book, or 35 days after their quote.</p>' +
      '</div>';
    try {
      await send({
        from: FROM, to: [TO],
        subject: 'Warm leads today: ' + (nudged2.length + nudged7.length) + ' quote' + (nudged2.length + nudged7.length === 1 ? '' : 's') + ' to follow up',
        html: html
      });
    } catch (err) { console.error('Digest email failed:', err); }
  }

  return { statusCode: 200, body: 'ok: ' + nudged2.length + ' first nudges, ' + nudged7.length + ' final' };
};
