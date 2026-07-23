/*
 * Minimal Google Sheets API client using a service account (JWT bearer
 * flow) - no googleapis dependency, just crypto + fetch, matching the rest
 * of the codebase. Fails soft (returns false, never throws) if not
 * configured, so a missing/misconfigured Sheets setup never blocks a
 * customer-facing page.
 *
 * Needs three Netlify env vars (see SETUP-SHEETS.md):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL - client_email from the service account JSON key
 *   GOOGLE_SERVICE_ACCOUNT_KEY   - private_key from that same JSON key
 *   WAITLIST_SHEET_ID            - the target spreadsheet's ID (from its URL)
 *
 * The sheet must be shared with GOOGLE_SERVICE_ACCOUNT_EMAIL as an Editor,
 * or every append will fail with a permission error (logged, not thrown).
 */

var crypto = require('crypto');

function base64url(buf) {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

var cachedToken = null; // { token, expiresAt }

async function getAccessToken() {
  var email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  var key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !key) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.token;

  var now = Math.floor(Date.now() / 1000);
  var header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claim = base64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));
  var signingInput = header + '.' + claim;
  var privateKey = key.indexOf('\\n') !== -1 ? key.replace(/\\n/g, '\n') : key;
  var signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  } catch (e) {
    console.error('Google service account key is invalid:', e.message);
    return null;
  }
  var jwt = signingInput + '.' + base64url(signature);

  var r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  if (!r.ok) { console.error('Google token error:', await r.text()); return null; }
  var json = await r.json();
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

/* Appends one row to the sheet (first tab, columns A onward).
   row = array of cell values. Best-effort - logs and returns false on any
   failure, never throws, so callers can fire this without risking the
   customer-facing flow it's attached to. */
async function appendRow(row) {
  var sheetId = process.env.WAITLIST_SHEET_ID;
  if (!sheetId) return false;
  try {
    var token = await getAccessToken();
    if (!token) return false;
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId +
      '/values/A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
    var r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    });
    if (!r.ok) { console.error('Sheets append error:', await r.text()); return false; }
    return true;
  } catch (e) {
    console.error('Sheets append failed:', e);
    return false;
  }
}

module.exports = { appendRow: appendRow };
