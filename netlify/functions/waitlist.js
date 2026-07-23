/*
 * MB Storage - "join the waiting list" opt-in for a sold-out size/site.
 *
 * Linked from the quote email's fully-booked panel (see quote.js). First
 * visit shows a confirm button (so email security scanners that pre-fetch
 * links can't sign people up by accident); confirming stores the entry in
 * Netlify Blobs, and the scheduled waitlist-notify.js job emails them
 * automatically the moment that exact size/site frees up.
 */

var blobs = require('./lib/blobs');
var sheets = require('./lib/sheets');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

var SITE_LABELS = { batley: 'Batley', liversedge: 'Liversedge', either: 'Batley or Liversedge - whichever frees up first' };
var SIZE_LABELS = { '20ft': '20ft container', '8ft': '8ft container' };

function page(title, body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="robots" content="noindex"><title>' + esc(title) + ' | MB Storage</title></head>' +
      '<body style="font-family:Segoe UI,Arial,sans-serif;background:#f2f5f8;margin:0;padding:40px 16px">' +
      '<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e4e1da;border-radius:14px;padding:32px;text-align:center">' +
      body +
      '<p style="margin-top:28px;font-size:12px;color:#9a9384">MB Storage &middot; 07375 355233 &middot; info@mbstorage.co.uk</p>' +
      '</div></body></html>'
  };
}

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var email = String(params.e || '').trim().toLowerCase();
  var name = String(params.n || '').trim().slice(0, 100);
  var phone = String(params.p || '').trim().slice(0, 30);
  var site = String(params.site || '').trim().toLowerCase();
  var size = String(params.size || '').trim().toLowerCase();

  if (!email || email.indexOf('@') === -1) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t include a valid email address. Please use the link from your quote email, or contact us and we\'ll add you by hand.</p>');
  }
  if (!SITE_LABELS[site] || !SIZE_LABELS[size]) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t say which size or site you\'re after. Please use the link from your quote email, or contact us and we\'ll add you by hand.</p>');
  }

  var what = SIZE_LABELS[size] + ' at ' + SITE_LABELS[site];

  var missingPhone = params.confirm === '1' && !phone;
  if (params.confirm !== '1' || missingPhone) {
    return page('Join the waiting list?',
      '<h2 style="color:#1E4C6B">Join the waiting list?</h2>' +
      (missingPhone ? '<p style="color:#b3261e;font-weight:600;margin:0 0 10px">Please add a phone number to continue.</p>' : '') +
      '<p style="color:#5b5648;line-height:1.6">We\'ll email <strong>' + esc(email) + '</strong> the moment a ' + esc(what) + ' becomes available. No spam - just the one email when it\'s ready.</p>' +
      '<form method="GET" style="margin-top:16px;text-align:left">' +
        '<input type="hidden" name="site" value="' + esc(site) + '">' +
        '<input type="hidden" name="size" value="' + esc(size) + '">' +
        '<input type="hidden" name="e" value="' + esc(email) + '">' +
        '<input type="hidden" name="n" value="' + esc(name) + '">' +
        '<input type="hidden" name="confirm" value="1">' +
        '<label for="wl-phone" style="display:block;font-size:13px;font-weight:600;color:#22303a;margin-bottom:6px">Phone number *</label>' +
        '<input id="wl-phone" type="tel" name="p" value="' + esc(phone) + '" required placeholder="07xxx xxxxxx" ' +
          'style="width:100%;box-sizing:border-box;padding:11px 14px;border:1px solid #d8d3c8;border-radius:8px;font-size:15px;margin-bottom:6px">' +
        '<p style="margin:0 0 14px;font-size:12px;color:#9a9384">In case it\'s quicker for us to call you when a space frees up.</p>' +
        '<button type="submit" style="display:inline-block;background:#00A34A;color:#fff;border:none;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;font-size:15px;cursor:pointer">Yes - add me to the waiting list</button>' +
      '</form>');
  }

  try {
    var key = 'w-' + site + '-' + size + '-' + email;
    var addedAt = Date.now();
    await blobs.store('waitlist-log').setJSON(key, {
      name: name || 'there', email: email, phone: phone, site: site, size: size, addedAt: addedAt, notified: false
    });
    await sheets.appendRow([
      name || 'there', email, phone, SIZE_LABELS[size], SITE_LABELS[site],
      new Date(addedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }), 'waiting'
    ]);
  } catch (err) {
    console.error('Waitlist signup failed:', err);
    return page('Sorry - that didn\'t work', '<h2 style="color:#1E4C6B">Sorry - that didn\'t work</h2><p style="color:#5b5648">Please try again in a minute, or just reply to your quote email and we\'ll add you by hand.</p>');
  }

  return page('You\'re on the list',
    '<h2 style="color:#008a3f">Done - you\'re on the list</h2>' +
    '<p style="color:#5b5648;line-height:1.6">We\'ll email <strong>' + esc(email) + '</strong> the moment a ' + esc(what) + ' becomes available.</p>');
};
