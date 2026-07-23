# Auto-sync the waiting list to Google Sheets

Once set up, every "join the waiting list" signup appends a row to your
Google Sheet automatically. Fails soft: if this isn't set up (or breaks),
signups still work exactly as before, they just don't sync to the sheet.

The sheet: [MB Storage - Waiting List](https://docs.google.com/spreadsheets/d/1xMOZzMmEfPjloOt-fto1-84EuKO0YgFk5oClNBHL7PQ/edit)

Three steps, all inside the Sheet itself - no Google Cloud console, no API
keys.

## 1. Paste a small script into the sheet

1. Open the sheet above → **Extensions → Apps Script**.
2. Delete anything in the editor and paste this in:

   ```js
   var SECRET = 'choose-any-password-here';

   function doPost(e) {
     var data = JSON.parse(e.postData.contents);
     if (data.secret !== SECRET) return ContentService.createTextOutput('forbidden');
     SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().appendRow(data.row);
     return ContentService.createTextOutput('ok');
   }
   ```
3. Change `choose-any-password-here` to any password you like - just
   remember it for step 3.
4. **Save** (disk icon or Ctrl/Cmd+S), name the project anything.

## 2. Deploy it as a web app

1. Top right → **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy**.
4. It'll ask you to authorise - click through (Google will warn it's
   unverified, that's normal for a script only you use - **Advanced →
   Go to [project name] (unsafe)**).
5. Copy the **Web app URL** it gives you (ends in `/exec`).

## 3. Add two variables to Netlify

In **Netlify → Site settings → Environment variables**, add:

| Key | Value |
|-----|-------|
| `WAITLIST_SHEET_WEBHOOK_URL` | the Web app URL from step 2 |
| `WAITLIST_SHEET_SECRET` | the same password you set in step 1 |

Trigger a redeploy (Netlify → Deploys → Trigger deploy).

## Test it

Use the "Join the waiting list" link from a test quote email and confirm
the signup - a new row should appear in the sheet within a few seconds. If
not, check Netlify function logs (Functions → waitlist) for a "Sheet
webhook error" message.

## If you ever need to change the password or redeploy the script

Editing the script requires deploying again: **Deploy → Manage deployments
→ pencil icon → New version → Deploy**. The URL stays the same.

## Known limitation

Rows are added when someone joins the list, but not updated afterwards -
if a waiting-list customer is later emailed because a unit freed up, the
sheet's "Status" column still says "waiting" (the admin viewer at
`/.netlify/functions/waitlist-list` always shows the live status, so
that's the source of truth for that).
