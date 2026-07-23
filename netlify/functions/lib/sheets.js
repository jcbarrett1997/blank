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
    if (!r.ok) { console.error('Sheet webhook error:', r.status, await r.text()); return false; }
    return true;
  } catch (e) {
    console.error('Sheet webhook failed:', e);
    return false;
  }
}

module.exports = { appendRow: appendRow };
