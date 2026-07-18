/*
 * MB Storage - one-click "stop these reminders" for quote follow-ups.
 *
 * Linked from every follow-up email. First visit shows a confirm button
 * (so email security scanners that pre-fetch links can't unsubscribe
 * people by accident); confirming writes a stop marker that the daily
 * follow-up job honours permanently.
 */

var blobs = require('./lib/blobs');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
      '<p style="margin-top:28px;font-size:12px;color:#9a9384">MB Storage · 07375 355233 · info@mbstorage.co.uk</p>' +
      '</div></body></html>'
  };
}

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var email = String(params.e || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) {
    return page('Reminders', '<h2 style="color:#1E4C6B">Something\'s missing</h2><p style="color:#5b5648">This link doesn\'t include a valid email address. Please use the link from your reminder email, or contact us and we\'ll sort it.</p>');
  }

  if (params.confirm !== '1') {
    var confirmUrl = '?e=' + encodeURIComponent(email) + '&confirm=1';
    return page('Stop reminders',
      '<h2 style="color:#1E4C6B">Stop quote reminders?</h2>' +
      '<p style="color:#5b5648;line-height:1.6">We\'ll stop sending reminder emails about the storage quote for <strong>' + esc(email) + '</strong>. Your quote itself stays valid - you can still book or get in touch any time.</p>' +
      '<a href="' + confirmUrl + '" style="display:inline-block;margin-top:12px;background:#00A34A;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;font-size:15px">Yes - stop the reminders</a>');
  }

  try {
    await blobs.store('quote-log').setJSON('stop-' + email, { ts: Date.now() });
  } catch (err) {
    console.error('Stop marker failed:', err);
    return page('Reminders', '<h2 style="color:#1E4C6B">Sorry - that didn\'t work</h2><p style="color:#5b5648">Please try again in a minute, or just reply to the reminder email and we\'ll stop them manually.</p>');
  }

  return page('Reminders stopped',
    '<h2 style="color:#008a3f">Done - no more reminders</h2>' +
    '<p style="color:#5b5648;line-height:1.6">We won\'t email <strong>' + esc(email) + '</strong> about this quote again. It stays valid for its full 30 days though - if you change your mind, just book online from your quote email, reply to it, or call us.</p>');
};
