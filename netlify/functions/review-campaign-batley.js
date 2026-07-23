/*
 * MB Storage - one-off Google review request campaign for Batley customers
 * (scheduled - see netlify.toml). Spreads a manually-curated customer list
 * across 5 working days (skipping the weekend) so it doesn't land as a
 * single spammy-looking blast - good for deliverability.
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
var REVIEW_URL = 'https://g.page/r/CZuIZwfEOQ3NEBM/review';

// [greeting, customerName, email]
var BATCHES = [
  { date: '2026-07-23', customers: [
    ['there', 'A2Z Commercial Projects', 'mick@a2zjoineryprojectsltd.co.uk'],
    ['Aamir', 'Aamir Kathrada', 'aamir.kath@outlook.com'],
    ['Adetola', 'Adetola Babalola', 'adetola.babalola@yahoo.com'],
    ['there', 'Affinity Homes Northern Ltd', 'kershawmark21@gmail.com'],
    ['Alister', 'Alister Hick', 'alister.hick@outlook.com'],
    ['Andrew', 'Andrew Wilson', 'ro5ey.yaqoob@gmail.com'],
    ['Angela', 'Angela Morton', 'angcharlie1967@gmail.com'],
    ['there', 'B & B Plastics', 'bandbplastics@hotmail.co.uk'],
    ['Balmoral', 'Balmoral Comfort International', 'mehranishaq@hotmail.co.uk'],
    ['Bartosz', 'Bartosz Spica', 'angelozf@gmail.com'],
    ['there', 'Batley Sprinters Limited', 'batleysprinters@gmail.com'],
    ['there', 'BDS Yorkshire Limited', 'accounts@bdsyorkshire.com'],
    ['there', 'Bed Empire', 'bedempireltd@gmail.com'],
    ['Ben', 'Ben Freeman', 'backchat85@gmail.com'],
    ['there', 'Brewbaker Engineering Ltd', 'michelle@brewbakerengineering.co.uk'],
    ['there', 'Bronte Stair Lifts', 'info@brontestairlifts.co.uk'],
    ['there', 'CB Parks ltd', 'martinbarrett99@hotmail.com'],
    ['Charlotte', 'Charlotte Wadsworth', 'charlottewadsworth2013@hotmail.co.uk'],
    ['there', 'd&p Motorcycle ATV Parts specialist', 'missimoo2004@yahoo.co.uk'],
    ['there', 'Damar Supplies Ltd', 'dianne@swimmingpoolsupplies.co.uk']
  ]},
  { date: '2026-07-24', customers: [
    ['Daniel', 'Daniel Waterhouse', 'dan_viper@hotmail.co.uk'],
    ['David', 'David Brown', 'davidjohnbrown900@gmail.com'],
    ['there', 'DB Auto Services', 'thedavidbruce@gmail.com'],
    ['Denise', 'Denise Barton', 'denise.barton@homecall.co.uk'],
    ['there', 'EES Yorkshire', 'info@eesyorkshire.co.uk'],
    ['Fozia', 'Fozia Mahmood', 'foziamahmood_1989@hotmail.co.uk'],
    ['there', 'Garolla Holdings Ltd', 'n.housley@garolla.co.uk'],
    ['Gavin', 'Gavin Douglas', 'gavin@euro-gen.co.uk'],
    ['Ian', 'Ian Milner', 'Ianmilner2810@gmail.com'],
    ['there', 'Innovation Beds', 'innovationbedss@gmail.com'],
    ['there', 'J P Transport Ltd', 'info@jptransport.uk'],
    ['there', 'J. M. Morris', 'thegrassdoctor64@aol.com'],
    ['Jake', 'Jake Mitchell', 'denbyjake18@icloud.com'],
    ['James', 'James Grimshaw', 'james_g_08@hotmail.com'],
    ['there', 'James Hanson', 'floyd_809@hotmail.com'],
    ['Jo', 'Jo Haywood', 'joannaasquith@outlook.com'],
    ['Jodie', 'Jodie Furness-Howe', 'j.furness-howe@hotmail.com'],
    ['Jon', 'Jon Graves', 'jon@jongraves.co.uk'],
    ['there', 'Jwl Interior Projects Ltd', 'jamie@jwlinteriors.co.uk'],
    ['Kassi', 'Kassi Bousfield', 'kassi.bousfield@icloud.com']
  ]},
  { date: '2026-07-27', customers: [
    ['Katie', 'Katie Bolland', 'katiebolland@live.co.uk'],
    ['Kevin', 'Kevin Craik', 'zun@sent.com'],
    ['there', 'KL & Sons', 'klandsons@outlook.com'],
    ['Leoan', 'Leoan Wardle', 'lpwardle14@gmail.com'],
    ['Louise', 'Louise Mallinson', 'mallinsonlouise02@gmail.com'],
    ['there', 'Louise Walker', 'nuttylush@gmail.com'],
    ['there', 'Love Sweet Love Events', 'lovesweetlove@hotmail.co.uk'],
    ['there', 'LP Groundworks & Resin Ltd', 'info@lpgr.co.uk'],
    ['there', 'Majestic Beds', 'hishtiaq194@gmail.com'],
    ['Media', 'Media Mavericks', 'harryadamson@mediamavericks.co.uk'],
    ['Mehmoona', 'Mehmoona Hussain', 'mehmoonahussain@gmail.com'],
    ['there', 'MIMS WHOLESALE LTD', 'infaaz1@gmail.com'],
    ['there', 'Mini Travel Executive', 'info@minitravelexecutive.co.uk'],
    ['Mohammed', 'Mohammed Nadeem Syeed', 'nadeem.sayeed18@outlook.com'],
    ['Mohammed', 'Mohammed Shakil Sharif', 'kaazimrashid41@gmail.com'],
    ['Mohsin', 'Mohsin Ali', 'mohsin.ma562@gmail.com'],
    ['there', 'Mount Plastics Ltd', 'mountplasticsltd@gmail.com'],
    ['there', 'Mrs Bouquet', 'mrsbouquets1@hotmail.co.uk'],
    ['there', 'Nick Smith', 'nick.smith@rewardfunding.co.uk'],
    ['Paul', 'Paul Allan', 'paulnmadmoo@gmail.com']
  ]},
  { date: '2026-07-28', customers: [
    ['Pegasus', 'Pegasus Mechanical & Refrigeration', 'nathan@pegasusmechanical-refrigeration.co.uk'],
    ['Peter', 'Peter Lynes', 'petedotlynes@gmail.com'],
    ['R', 'R Bros Bargains', 'richiedeanhughes@gmail.com'],
    ['Richard', 'Richard Mason', 'rikmason@hotmail.co.uk'],
    ['there', 'Richmond Roofing Single ply Ltd', 'ddelap@rrsp.co.uk'],
    ['there', 'Rightgreen Recycle Ltd', 'accounts@rightgreen.co.uk'],
    ['there', 'RJN Decorative', 'dave.neville@rjndecorating.co.uk'],
    ['there', 'Robin Hood Wholesale', 'robinhoodossett@gmail.com'],
    ['Ron', 'Ron Dakin', 'rondakin21@gmail.com'],
    ['Ryan', 'Ryan Mason', 'ryan_mason26392@hotmail.com'],
    ['Ryan', 'Ryan Secker', 'secker75@googlemail.com'],
    ['Safir', 'Safir Hussain', 'b19saf786@hotmail.co.uk'],
    ['Sam', 'Sam Wragg', 'samwragg16@gmail.com'],
    ['Sara', 'Sara Patel', 'patelsara71@hotmail.com'],
    ['there', 'School Photography Company', 'accounts@schoolphotographs.co.uk'],
    ['Shak', 'Shak Khan', 'shak8888@hotmail.co.uk'],
    ['Shona', 'Shona Pickles', 'pickles3@hotmail.com'],
    ['there', 'Smallwood PHR Ltd', 'smallwoodphrltd@gmail.com'],
    ['Stephen', 'Stephen Childs', 'killbuni@outlook.com'],
    ['Sue', 'Sue Halstead', 'suehalstead3010@hotmail.com']
  ]},
  { date: '2026-07-29', customers: [
    ['Sufiyan', 'Sufiyan Sallu', 'sufiyansallu@gmail.com'],
    ['there', 'Tony Harrison Limited', 'Tonyharrison.thl@gmail.com'],
    ['Tracy', 'Tracy Jones', 'tracydeaco@hotmail.com'],
    ['there', 'UK Used Furniture', 'uk1used@hotmail.com'],
    ['there', 'Upgrowth Digital', 'info@upgrowthdigital.co.uk'],
    ['there', 'Yaan Pro Ltd', 'saarnstarsltd@gmail.com'],
    ['Yahya', 'Yahya Hussain', 'yoyo28498@hotmail.co.uk']
  ]}
  // Deliberately excludes the "Hold - money owed" list from the source
  // spreadsheet - asking for a review while a balance is outstanding is a
  // bad look. Those customers can be emailed separately by hand once
  // settled, if at all.
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
          '<p style="margin:0 0 16px;font-size:15px;color:#5b5648;line-height:1.6">Just a quick note to say thank you for storing with us at MB Storage in Batley - we really appreciate you choosing us.</p>' +
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
      'Just a quick note to say thank you for storing with us at MB Storage in Batley - we really appreciate you choosing us.', '',
      'If you\'ve been happy with things and have a spare moment, a short Google review would mean a lot. We\'re a small, family-run business, and it genuinely helps other local people find us. No pressure at all if now\'s not a good time:', '',
      REVIEW_URL, '',
      'And if anything hasn\'t been quite right, please tell us first - reply to this email or call 07375 355233 and we\'ll put it right.', '',
      'Thanks so much,', 'The MB Storage family',
      '07375 355233 | info@mbstorage.co.uk | mbstorage.co.uk'
    ].join('\n')
  };
}

function todayInLondon() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
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
  var store = blobs.store('review-campaign-batley-log');
  var send = makeSender();
  var results = [];

  for (var b = 0; b < BATCHES.length; b++) {
    var batch = BATCHES[b];
    if (today < batch.date) continue; // not due yet

    for (var i = 0; i < batch.customers.length; i++) {
      var row = batch.customers[i];
      var greeting = row[0], name = row[1], email = String(row[2]).trim().toLowerCase();
      var key = 'sent-' + email;

      var already = await store.get(key);
      if (already) continue;

      try {
        var msg = reviewEmail(greeting);
        await send({ from: FROM, to: [email], reply_to: TO, subject: msg.subject, html: msg.html, text: msg.text });
        await store.setJSON(key, { name: name, sentAt: new Date().toISOString(), batch: batch.date });
        results.push(name + ' <' + email + '> (batch ' + batch.date + ') - sent');
      } catch (err) {
        console.error('Review campaign send failed for ' + email + ':', err.message);
        results.push(name + ' <' + email + '> (batch ' + batch.date + ') - FAILED: ' + err.message);
      }
    }
  }

  console.log('Review campaign (Batley) run ' + today + ':', results.length ? results.join(' | ') : 'nothing due');
  return { statusCode: 200, body: JSON.stringify({ ok: true, today: today, results: results }) };
};
