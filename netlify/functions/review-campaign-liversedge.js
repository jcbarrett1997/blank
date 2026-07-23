/*
 * MB Storage - one-off Google review request campaign for Liversedge
 * customers (scheduled - see netlify.toml). Spreads a manually-curated
 * customer list across 2 working days (skipping the weekend) so it
 * doesn't land as a single spammy-looking blast - good for deliverability.
 *
 * Runs daily; on each run it sends every batch that's "due" (its date has
 * arrived) and hasn't been sent yet. Idempotent per email address via
 * Netlify Blobs, so re-runs (retries, manual triggers) never double-send.
 *
 * This is a standalone one-off - separate from the automatic
 * review-request.js flow (14 days post-move-in). Once every batch below
 * has been sent, this function can be deleted along with its netlify.toml
 * schedule entry.
 */

var blobs = require('./lib/blobs');

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');
var REVIEW_URL = 'https://g.page/r/CWPSsbOJJsfgEBM/review';

// [greeting, customerName, email]
var BATCHES = [
  { date: '2026-07-23', customers: [
    ['Andrew', 'Andrew Hirst', 'andrewhirst3@sky.com'],
    ['Anwar', 'Anwar Ali', 'anwar.ali@btinternet.com'],
    ['Callum', 'Callum Curry', 'jackcalcurry@gmail.com'],
    ['there', 'CHH Conex', 'craig.stack@chhconex.com'],
    ['there', 'Chickfellas Limited', 'ateeq@chickfellas.co.uk'],
    ['Danny', 'Danny McCabe', 'djmccabe27@gmail.com'],
    ['Danny', 'Danny Mitchell', 'danny.michell@btinternet.com'],
    ['Dave', 'Dave Cockerham', 'kateanddavethegeeks@gmail.com'],
    ['Des', 'Des Macorison (Made By Macorison)', 'emailus@madebymacorison.com'],
    ['Diane', 'Diane Wood', 'aries.h60@hotmail.co.uk'],
    ['there', 'ENTS Creative Ltd', 'info@entsgroup.co.uk'],
    ['Fiona', 'Fiona Carter', 'fjcarter@mail.com'],
    ['there', 'Freightmate Couriers', 'freightmate@live.co.uk'],
    ['Gary', 'Gary Sharp', 'garysharp8888@gmail.com'],
    ['there', 'Harrison Trim Supplies', 'accounts@harrisontrimsupplies.com'],
    ['there', 'ICON Scaffolding', 'iconscaffolding@yahoo.com'],
    ['Jabir', 'Jabir Patel', 'jsp051104@gmail.com']
  ]},
  { date: '2026-07-24', customers: [
    ['Kaazim', 'Kaazim Rashid', 'kaazimrashid41@gmail.com'],
    ['there', 'Lanec Ltd', 'paul@lanec.co.uk'],
    ['Lewis', 'Lewis Higgins', 'lewishiggins92@gmail.com'],
    ['Liam', 'Liam Walker', 'liamw2440@gmail.com'],
    ['there', 'Lynx Precast Ltd', 'paulcutler@lynxprecast.co.uk'],
    ['Martyn', 'Martyn Walker', 'martynwalker1975@gmail.com'],
    ['Megan', 'Megan Watson', 'meganpwatson@gmail.com'],
    ['Paul', 'Paul Owens (Architectural Street Furnishings Ltd)', 'Paul@asfco.co.uk'],
    ['Philip', 'Philip Verity (Verity Fashion Ltd)', 'philip@verityfashion.com'],
    ['Sam', 'Sam Hartley', 'samhartley7@gmail.com'],
    ['Scott', 'Scott Ainsworth', 'scottainsworthltd@gmail.com'],
    ['there', 'Sustainable Traffic Solutions Ltd', 'Accounts@sustainabletraffic.co.uk'],
    ['there', 'The Little Luxe Party Co', 'thelittleluxepartyco@gmail.com'],
    ['there', 'Thoresby Electrical Controls Ltd', 'brad@thoresbyelectrical.co.uk'],
    ['Tim', 'Tim Bresnan', 'timbresnan20@gmail.com']
  ]}
  // Excludes CB Parks (no email on file), Aneeqah Kauser (owes £74) and
  // Expo Supply Chain (owes £50) from the source export - asking for a
  // review while a balance is outstanding is a bad look. Those can be
  // emailed separately by hand once settled, if at all.
];

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

function reviewEmail(greeting) {
  return {
    subject: 'A small favour, if you have 30 seconds? 🙂',
    html:
      '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e1da">' +
        '<tr><td style="background:#ffffff;padding:22px 28px" align="left"><img src="' + SITE + '/assets/img/logo-landscape@4x.png" alt="MB Storage" height="44" style="height:44px;display:block"></td></tr>' +
        '<tr><td style="height:5px;background:#00A34A"></td></tr>' +
        '<tr><td style="padding:28px">' +
          '<p style="margin:0 0 12px;font-size:16px;color:#22303a">Hi ' + esc(greeting) + ',</p>' +
          '<p style="margin:0 0 16px;font-size:15px;color:#5b5648;line-height:1.6">Just a quick note to say thank you for storing with us at MB Storage in Liversedge - we really appreciate you choosing us.</p>' +
          '<p style="margin:0 0 20px;font-size:15px;color:#5b5648;line-height:1.6">If you\'ve been happy with things and have a spare moment, a short Google review would mean a lot. We\'re a small, family-run business, and it genuinely helps other local people find us. No pressure at all if now\'s not a good time:</p>' +
          '<div style="text-align:center;margin:0 0 22px">' +
            '<a href="' + esc(REVIEW_URL) + '" style="display:inline-block;background:#00A34A;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 30px;border-radius:999px;font-size:16px">Leave a quick review ⭐</a>' +
          '</div>' +
          '<p style="margin:0 0 8px;font-size:14px;color:#5b5648;line-height:1.6">And if anything hasn\'t been quite right, please tell <em>us</em> first - just reply to this email or call <a href="tel:+447375355233" style="color:#008a3f">07375 355233</a> and we\'ll put it right.</p>' +
          '<p style="margin:16px 0 0;font-size:14px;color:#5b5648;line-height:1.6">Thanks so much,<br>The MB Storage family</p>' +
        '</td></tr>' +
        '<tr><td style="background:#22190A;padding:18px 28px;color:#cfc9bd;font-size:12px">MB Storage &middot; <a href="tel:+447375355233" style="color:#cfc9bd">07375 355233</a> &middot; <a href="mailto:info@mbstorage.co.uk" style="color:#cfc9bd">info@mbstorage.co.uk</a> &middot; <a href="' + SITE + '" style="color:#cfc9bd">mbstorage.co.uk</a></td></tr>' +
      '</table></td></tr></table></div>',
    text: [
      'Hi ' + greeting + ',', '',
      'Just a quick note to say thank you for storing with us at MB Storage in Liversedge - we really appreciate you choosing us.', '',
      'If you\'ve been happy with things and have a spare moment, a short Google review would mean a lot. We\'re a small, family-run business, and it genuinely helps other local people find us. No pressure at all if now\'s not a good time:', '',
      REVIEW_URL, '',
      'And if anything hasn\'t been quite right, please tell us first - reply to this email or call 07375 355233 and we\'ll put it right.', '',
      'Thanks so much,', 'The MB Storage family',
      '07375 355233 | info@mbstorage.co.uk | mbstorage.co.uk'
    ].join('\n')
  };
}

// Built from formatToParts rather than trusting a locale's default
// separator/order (en-CA usually gives YYYY-MM-DD, but that's an
// assumption about locale data, not a guarantee) - always 'YYYY-MM-DD'.
function todayInLondon() {
  var parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  var map = {};
  parts.forEach(function (p) { map[p.type] = p.value; });
  return map.year + '-' + map.month + '-' + map.day;
}

exports.handler = async function (event) {
  if (!process.env.RESEND_API_KEY && !process.env.MAILGUN_API_KEY) {
    return { statusCode: 200, body: 'email not configured' };
  }

  // Test mode: ?test=you@example.com sends a single sample email to that
  // address only - doesn't touch the real batches or the Blobs log, so it
  // can be run as many times as needed without affecting the real send.
  var testTo = event && event.queryStringParameters && event.queryStringParameters.test;
  if (testTo) {
    var send0 = makeSender();
    var msg0 = reviewEmail('there');
    msg0.subject = '[TEST] ' + msg0.subject;
    await send0({ from: FROM, to: [testTo], reply_to: TO, subject: msg0.subject, html: msg0.html, text: msg0.text });
    return { statusCode: 200, body: 'test email sent to ' + testTo };
  }

  var today = todayInLondon();
  var store = blobs.store('review-campaign-liversedge-log');
  var send = makeSender();
  var results = [];
  var batchStatus = [];
  var sentCount = 0, alreadyCount = 0, failedCount = 0;

  for (var b = 0; b < BATCHES.length; b++) {
    var batch = BATCHES[b];
    var due = today >= batch.date;
    batchStatus.push({ date: batch.date, due: due, customers: batch.customers.length });
    if (!due) continue; // not due yet

    for (var i = 0; i < batch.customers.length; i++) {
      var row = batch.customers[i];
      var greeting = row[0], name = row[1], email = String(row[2]).trim().toLowerCase();
      var key = 'sent-' + email;

      var already = await store.get(key);
      if (already) { alreadyCount++; continue; }

      try {
        var msg = reviewEmail(greeting);
        await send({ from: FROM, to: [email], reply_to: TO, subject: msg.subject, html: msg.html, text: msg.text });
        await store.setJSON(key, { name: name, sentAt: new Date().toISOString(), batch: batch.date });
        results.push(name + ' <' + email + '> (batch ' + batch.date + ') - sent');
        sentCount++;
      } catch (err) {
        console.error('Review campaign send failed for ' + email + ':', err.message);
        results.push(name + ' <' + email + '> (batch ' + batch.date + ') - FAILED: ' + err.message);
        failedCount++;
      }
    }
  }

  console.log('Review campaign (Liversedge) run ' + today + ':', results.length ? results.join(' | ') : 'nothing due',
    '| batches:', JSON.stringify(batchStatus), '| sent:', sentCount, 'alreadySent:', alreadyCount, 'failed:', failedCount);
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true, today: today, sentCount: sentCount, alreadyCount: alreadyCount, failedCount: failedCount,
      batchStatus: batchStatus, results: results
    })
  };
};
