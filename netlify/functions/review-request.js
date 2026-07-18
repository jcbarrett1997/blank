/*
 * MB Storage - automated Google review request (scheduled daily).
 *
 * ~14 days after a customer's move-in (or their booking date if no
 * move-in date), sends one warm email asking for a Google review, with a
 * direct link to the right site's review page. One email per customer,
 * ever. Powered by the review-log entries the Stripe booking webhook
 * writes; entries are cleaned up 45 days after sending.
 *
 * Review links (get the "leave a review" shortlink from each Google
 * Business Profile -> Ask for reviews -> copy link; falls back to the
 * public profile links already on the site):
 *   GOOGLE_REVIEW_URL_BATLEY
 *   GOOGLE_REVIEW_URL_LIVERSEDGE
 */

var blobs = require('./lib/blobs');

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');
var DAY = 24 * 60 * 60 * 1000;

var REVIEW_URLS = {
  batley: process.env.GOOGLE_REVIEW_URL_BATLEY || 'https://share.google/FKLlhXwnTdkLFq2XG',
  liversedge: process.env.GOOGLE_REVIEW_URL_LIVERSEDGE || 'https://share.google/wF9zgcL8YftSkXofP'
};

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

function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }

function reviewEmail(rec, url) {
  return {
    subject: 'How\'s your MB Storage unit? A quick favour if you have a sec',
    html:
      '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
        '<tr><td style="background:#ffffff;padding:22px 28px" align="left"><img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="44" style="height:44px;display:block"></td></tr>' +
        '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
        '<tr><td style="padding:28px">' +
          '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc(firstName(rec.name)) + ',</p>' +
          '<p style="margin:0 0 16px;font-size:15px;color:#5b5648;line-height:1.6">You\'ve been with us a couple of weeks now - we hope your unit\'s working out and everything\'s been smooth.</p>' +
          '<p style="margin:0 0 20px;font-size:15px;color:#5b5648;line-height:1.6">We\'re a family-run business, and a quick Google review genuinely makes a huge difference to us - it helps other local people find storage they can trust. If you have 30 seconds, we\'d be really grateful:</p>' +
          '<div style="text-align:center;margin:0 0 22px">' +
            '<a href="' + esc(url) + '" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 30px;border-radius:999px;font-size:16px">Leave a quick review ⭐</a>' +
          '</div>' +
          '<p style="margin:0 0 8px;font-size:14px;color:#5b5648;line-height:1.6">And if anything hasn\'t been quite right, please tell <em>us</em> first - just reply to this email or call <a href="tel:+447375355233" style="color:#008a3f">07375 355233</a> and we\'ll put it right.</p>' +
          '<p style="margin:16px 0 0;font-size:14px;color:#5b5648;line-height:1.6">Thanks so much,<br>The MB Storage family</p>' +
        '</td></tr>' +
        '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; <a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; <a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a></td></tr>' +
      '</table></td></tr></table></div>',
    text: [
      'Hi ' + firstName(rec.name) + ',', '',
      'You\'ve been with us a couple of weeks now - we hope your unit\'s working out and everything\'s been smooth.', '',
      'We\'re a family-run business, and a quick Google review genuinely makes a huge difference to us. If you have 30 seconds, we\'d be really grateful:', '',
      url, '',
      'And if anything hasn\'t been quite right, please tell us first - reply to this email or call 07375 355233 and we\'ll put it right.', '',
      'Thanks so much,', 'The MB Storage family',
      '07375 355233 | info@mbstorage.co.uk | mbstorage.co.uk'
    ].join('\n')
  };
}

exports.handler = async function () {
  if (!process.env.MAILGUN_API_KEY && !process.env.RESEND_API_KEY) {
    return { statusCode: 200, body: 'email not configured' };
  }
  var store = blobs.store('review-log');
  var listing;
  try { listing = await store.list(); } catch (e) {
    console.log('review-request: blobs unavailable - ' + e.message);
    return { statusCode: 200, body: 'blobs unavailable' };
  }
  var keys = (listing.blobs || []).map(function (b) { return b.key; });
  var now = Date.now();
  var send = makeSender();
  var sentCount = 0;

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.indexOf('rev-') !== 0) continue;
    var rec = await store.get(key, { type: 'json' });
    if (!rec || !rec.email) { await store.delete(key); continue; }

    if (rec.sent) {
      if (rec.sentAt && now - rec.sentAt > 45 * DAY) await store.delete(key);
      continue;
    }

    var base = rec.ts;
    if (rec.moveIn) {
      var mv = new Date(rec.moveIn + 'T12:00:00');
      if (!isNaN(mv.getTime())) base = mv.getTime();
    }
    if (now < base + 14 * DAY) continue;

    var siteKey = String(rec.site || '').toLowerCase();
    var url = REVIEW_URLS[siteKey] || REVIEW_URLS.batley;

    try {
      var email = reviewEmail(rec, url);
      await send({ from: FROM, to: [rec.email], reply_to: TO, subject: email.subject, html: email.html, text: email.text });
      rec.sent = true; rec.sentAt = now;
      await store.setJSON(key, rec);
      sentCount++;
    } catch (err) {
      console.error('Review request failed for ' + rec.email + ':', err.message);
    }
  }

  return { statusCode: 200, body: 'ok: ' + sentCount + ' review requests sent' };
};
