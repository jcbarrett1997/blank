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
  var site = String(params.site || '').trim().toLowerCase();
  var size = String(params.size || '').trim().toLowerCase();

  if (!email || email.indexOf('@') === -1) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t include a valid email address. Please use the link from your quote email, or contact us and we\'ll add you by hand.</p>');
  }
  if (!SITE_LABELS[site] || !SIZE_LABELS[size]) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t say which size or site you\'re after. Please use the link from your quote email, or contact us and we\'ll add you by hand.</p>');
  }

  var what = SIZE_LABELS[size] + ' at ' + SITE_LABELS[site];

  if (params.confirm !== '1') {
    var confirmUrl = '?site=' + encodeURIComponent(site) + '&size=' + encodeURIComponent(size) +
      '&e=' + encodeURIComponent(email) + '&n=' + encodeURIComponent(name) + '&confirm=1';
    return page('Join the waiting list?',
      '<h2 style="color:#1E4C6B">Join the waiting list?</h2>' +
      '<p style="color:#5b5648;line-height:1.6">We\'ll email <strong>' + esc(email) + '</strong> the moment a ' + esc(what) + ' becomes available. No spam - just the one email when it\'s ready.</p>' +
      '<a href="' + confirmUrl + '" style="display:inline-block;margin-top:12px;background:#00A34A;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;font-size:15px">Yes - add me to the waiting list</a>');
  }

  try {
    var key = 'w-' + site + '-' + size + '-' + email;
    await blobs.store('waitlist-log').setJSON(key, {
      name: name || 'there', email: email, site: site, size: size, addedAt: Date.now(), notified: false
    });
  } catch (err) {
    console.error('Waitlist signup failed:', err);
    return page('Sorry - that didn\'t work', '<h2 style="color:#1E4C6B">Sorry - that didn\'t work</h2><p style="color:#5b5648">Please try again in a minute, or just reply to your quote email and we\'ll add you by hand.</p>');
  }

  return page('You\'re on the list',
    '<h2 style="color:#008a3f">Done - you\'re on the list</h2>' +
    '<p style="color:#5b5648;line-height:1.6">We\'ll email <strong>' + esc(email) + '</strong> the moment a ' + esc(what) + ' becomes available.</p>');
};
