/*
 * MB Storage - "join the waiting list" opt-in for a sold-out size/site.
 *
 * Reached either from the quote email's fully-booked panel (see quote.js,
 * which already has name/email/phone) or from waiting-list.html (which
 * collects them directly). Both already have everything needed.
 *
 * Spam/bot protection: Cloudflare Turnstile, same as contact.js. If
 * TURNSTILE_SITE_KEY is set, the first request shows an interstitial that
 * runs an invisible check and auto-submits itself the instant it passes -
 * no click needed from a real visitor, but a bare fetch from an email
 * security scanner (which never runs the page's JS) can't get through it.
 * Until TURNSTILE_SITE_KEY/TURNSTILE_SECRET_KEY are set, this step is
 * skipped entirely and signups store immediately, as before.
 */

var blobs = require('./lib/blobs');
var sheets = require('./lib/sheets');
var turnstile = require('./lib/turnstile');

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

function fieldsUrl(f) {
  return '?site=' + encodeURIComponent(f.site) + '&size=' + encodeURIComponent(f.size) +
    '&e=' + encodeURIComponent(f.email) + '&n=' + encodeURIComponent(f.name) + '&p=' + encodeURIComponent(f.phone);
}

function verifyingPage(siteKey, f) {
  return page('Just a moment...',
    '<h2 style="color:#1E4C6B">Just a moment...</h2>' +
    '<p style="color:#5b5648;line-height:1.6">Checking you\'re a real person before adding you to the waiting list - this only takes a second.</p>' +
    '<form id="wl-verify" method="GET">' +
      '<input type="hidden" name="site" value="' + esc(f.site) + '">' +
      '<input type="hidden" name="size" value="' + esc(f.size) + '">' +
      '<input type="hidden" name="e" value="' + esc(f.email) + '">' +
      '<input type="hidden" name="n" value="' + esc(f.name) + '">' +
      '<input type="hidden" name="p" value="' + esc(f.phone) + '">' +
      '<input type="hidden" name="t" id="wl-token" value="">' +
      '<div class="cf-turnstile" data-sitekey="' + esc(siteKey) + '" data-callback="wlVerified" ' +
        'style="margin:16px auto 0;display:flex;justify-content:center"></div>' +
      '<noscript><p style="margin-top:16px;color:#b3261e">Please enable JavaScript to join the waiting list, or call us on 07375 355233.</p></noscript>' +
    '</form>' +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' +
    '<script>function wlVerified(token){document.getElementById("wl-token").value=token;document.getElementById("wl-verify").submit();}</script>');
}

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var email = String(params.e || '').trim().toLowerCase();
  var name = String(params.n || '').trim().slice(0, 100);
  var phone = String(params.p || '').trim().slice(0, 30);
  var site = String(params.site || '').trim().toLowerCase();
  var size = String(params.size || '').trim().toLowerCase();
  var token = String(params.t || '').trim();

  if (!email || email.indexOf('@') === -1) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t include a valid email address. Please use the link from your quote email, or the <a href="/waiting-list.html">waiting list page</a>.</p>');
  }
  if (!SITE_LABELS[site] || !SIZE_LABELS[size]) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t say which size or site you\'re after. Please use the link from your quote email, or the <a href="/waiting-list.html">waiting list page</a>.</p>');
  }
  if (size === '8ft' && site === 'liversedge') {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">8ft containers are only ever available at our Batley site, so this combination will never free up. Please use the <a href="/waiting-list.html">waiting list page</a> to sign up for Batley instead.</p>');
  }
  if (!phone) {
    return page('Waiting list', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t include a phone number. Please use the <a href="/waiting-list.html">waiting list page</a> to sign up, or contact us and we\'ll add you by hand.</p>');
  }

  var fields = { email: email, name: name, phone: phone, site: site, size: size };
  var siteKey = process.env.TURNSTILE_SITE_KEY;

  if (siteKey && !token) {
    return verifyingPage(siteKey, fields);
  }
  if (siteKey) {
    var clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
    var human = await turnstile.verify(token, clientIp);
    if (!human) {
      return page('Sorry - that didn\'t work',
        '<h2 style="color:#1E4C6B">Sorry - that didn\'t work</h2>' +
        '<p style="color:#5b5648;line-height:1.6">We couldn\'t verify that submission. Please try again.</p>' +
        '<a href="' + esc(fieldsUrl(fields)) + '" style="display:inline-block;margin-top:12px;background:#00A34A;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;font-size:15px">Try again</a>');
    }
  }

  var what = SIZE_LABELS[size] + ' at ' + SITE_LABELS[site];

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
