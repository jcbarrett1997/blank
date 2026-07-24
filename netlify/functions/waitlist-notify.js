/*
 * MB Storage - notifies waiting-list customers the moment their size/site
 * frees up (scheduled - see netlify.toml). Reads the same published
 * availability sheet as the quote and booking pages (AVAILABILITY_SHEET_
 * CSV_URL). Each waitlist entry is only ever emailed once - marked
 * notified in the waitlist-log Blobs store - so re-runs never double up.
 *
 * Entries are created by waitlist.js from a link in the quote email's
 * fully-booked panel.
 */

var blobs = require('./lib/blobs');

var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';
var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');

var SITE_LABELS = { batley: 'Batley', liversedge: 'Liversedge' };
var SIZE_LABELS = { '20ft': '20ft container', '8ft': '8ft container' };

function bookingLive() {
  var v = String(process.env.BOOKING_LIVE || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  return v === 'true' || v === 'yes' || v === '1' || v === 'on';
}

/* Same self-service booking link the quote/follow-up emails use - this is
   the most time-critical moment of all (first come, first served), so it
   should never be phone-only just because it's a different email. Site is
   only pre-filled when exactly one of the customer's watched sites has
   freed up; with both, book.html's dropdown lets them pick. */
function bookingUrl(entry, availableAt) {
  if (!bookingLive()) return null;
  var p = new URLSearchParams();
  p.set('size', entry.size || '');
  if (availableAt.length === 1) p.set('site', availableAt[0]);
  if (entry.name) p.set('name', entry.name);
  if (entry.email) p.set('email', entry.email);
  if (entry.phone) p.set('phone', entry.phone);
  return SITE + '/book.html?' + p.toString();
}

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

/* Free units per "site-size" key, e.g. "batley-20ft". Returns null when the
   sheet is unset/unreachable/malformed - fail soft, skip this run. */
async function freeCounts() {
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
    var counts = {};
    rows.slice(1).forEach(function (row) {
      var n = parseInt(row[iFree], 10);
      if (isNaN(n)) return;
      var k = row[iSite] + '-' + row[iSize];
      counts[k] = (counts[k] || 0) + Math.max(0, n);
    });
    return counts;
  } catch (e) { console.error(e); return null; }
}

exports.handler = async function () {
  if (!process.env.RESEND_API_KEY && !process.env.MAILGUN_API_KEY) {
    return { statusCode: 200, body: 'email not configured' };
  }
  var counts = await freeCounts();
  if (!counts) {
    console.log('waitlist-notify: availability sheet unavailable - skipping.');
    return { statusCode: 200, body: 'availability unavailable' };
  }

  var store = blobs.store('waitlist-log');
  var listing;
  try { listing = await store.list(); } catch (e) {
    console.log('waitlist-notify: blobs unavailable - ' + e.message);
    return { statusCode: 200, body: 'blobs unavailable' };
  }
  var keys = (listing.blobs || []).map(function (b) { return b.key; });
  var send = makeSender();
  var notified = [];

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.indexOf('w-') !== 0) continue;
    var entry = await store.get(key, { type: 'json' });
    if (!entry || entry.notified) continue;

    var sitesToCheck = entry.site === 'either' ? ['batley', 'liversedge'] : [entry.site];
    var availableAt = sitesToCheck.filter(function (s) { return (counts[s + '-' + entry.size] || 0) > 0; });
    if (!availableAt.length) continue;

    var what = SIZE_LABELS[entry.size] || entry.size;
    var whereText = availableAt.map(function (s) { return SITE_LABELS[s] || s; }).join(' or ');
    var book = bookingUrl(entry, availableAt);

    try {
      await send({
        from: FROM, to: [entry.email], reply_to: TO,
        subject: 'Good news - a ' + what + ' is now available at ' + whereText,
        html: '<div style="background:#f2f5f8;padding:24px 0;font-family:Segoe UI,Arial,sans-serif">' +
          '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e1da;border-radius:14px;padding:28px">' +
          '<h2 style="margin:0 0 12px;color:#008a3f">Good news, ' + esc(entry.name || 'there') + '!</h2>' +
          '<p style="margin:0 0 14px;color:#22303a;font-size:15px;line-height:1.6">A <strong>' + esc(what) + '</strong> has just become available at <strong>' + esc(whereText) + '</strong> - you asked us to let you know.</p>' +
          '<p style="margin:0 0 18px;color:#5b5648;font-size:14px;line-height:1.6">Spaces like this go quickly' + (book ? ', so secure yours right now' : ', so get in touch as soon as you can') + ' and we\'ll get you booked in.</p>' +
          (book ? '<a href="' + book + '" style="display:inline-block;background:#00A34A;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;font-size:15px;margin-bottom:10px">Book online now</a><br>' : '') +
          '<a href="tel:+447375355233" style="display:inline-block;background:' + (book ? '#1E4C6B' : '#00A34A') + ';color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px;font-size:15px">Call 07375 355233</a>' +
          '<p style="margin:16px 0 0;font-size:12px;color:#5b5648">Or just reply to this email and we\'ll take it from there.</p>' +
          '</div></div>',
        text: 'Good news, ' + (entry.name || 'there') + '!\n\n' +
          'A ' + what + ' has just become available at ' + whereText + ' - you asked us to let you know.\n\n' +
          (book ? 'Book online now: ' + book + '\n\n' : '') +
          'Spaces like this go quickly - call 07375 355233 or reply to this email and we\'ll get you booked in.\n\n' +
          'MB Storage | ' + SITE
      });
      await store.setJSON(key, { name: entry.name, email: entry.email, phone: entry.phone, site: entry.site, size: entry.size, addedAt: entry.addedAt, notified: true, notifiedAt: Date.now() });
      notified.push(entry.email + ' (' + what + ' @ ' + whereText + ')');
    } catch (err) {
      console.error('Waitlist notify failed for ' + entry.email + ':', err.message);
    }
  }

  console.log('Waitlist notify run:', notified.length ? notified.join(' | ') : 'nothing to notify');
  return { statusCode: 200, body: JSON.stringify({ ok: true, notified: notified.length }) };
};
