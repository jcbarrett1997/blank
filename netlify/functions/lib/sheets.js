/*
 * Posts one row to a Google Sheet via a tiny Apps Script "web app" glued
 * directly to the sheet - no Google Cloud console, no service account, no
 * API keys (see SETUP-SHEETS.md). Fails soft: skips silently if
 * WAITLIST_SHEET_WEBHOOK_URL isn't set, so a customer-facing signup is
 * never blocked by a missing/broken sheet connection.
 */

async function appendRow(row) {
  var url = process.env.WAITLIST_SHEET_WEBHOOK_URL;
  if (!url) return false;
  try {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.WAITLIST_SHEET_SECRET || '', row: row })
    });
    var text = await r.text();
    // Apps Script web apps always return HTTP 200, even for a rejected
    // ('forbidden') request - the actual result is in the body, so check
    // that too or a wrong secret silently looks like success.
    if (!r.ok || text.trim() !== 'ok') { console.error('Sheet webhook error:', r.status, text); return false; }
    return true;
  } catch (e) {
    console.error('Sheet webhook failed:', e);
    return false;
  }
}

module.exports = { appendRow: appendRow };
