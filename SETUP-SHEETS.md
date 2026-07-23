# Auto-sync the waiting list to Google Sheets

Once set up, every "join the waiting list" signup appends a row to your
Google Sheet automatically - no copy/pasting needed. Fails soft: if this
isn't set up (or breaks), signups still work exactly as before, they just
don't sync to the sheet.

The sheet: [MB Storage - Waiting List](https://docs.google.com/spreadsheets/d/1xMOZzMmEfPjloOt-fto1-84EuKO0YgFk5oClNBHL7PQ/edit)

## 1. Create a Google Cloud service account (one-time)

A service account is a robot login the site's backend uses to write to the
sheet - it's separate from your own Google login and never expires or asks
for a password.

1. Go to **https://console.cloud.google.com/** and create a project (or
   pick an existing one) - the name doesn't matter, e.g. "MB Storage site".
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   Give it any name (e.g. `waitlist-sync`) and click through to **Done**.
4. Click into the new service account → **Keys** tab → **Add key → Create
   new key → JSON** → **Create**. A `.json` file downloads - keep it safe,
   you'll need two values from it in a moment.

## 2. Share the sheet with the service account

Open that downloaded JSON file and find the `client_email` field (looks
like `waitlist-sync@your-project.iam.gserviceaccount.com`).

In the Google Sheet above: **Share** → paste that email → set it to
**Editor** → **Send** (untick "Notify people" - it's a robot, not a person).

## 3. Add three variables to Netlify

In **Netlify → Site settings → Environment variables**, add:

| Key | Value |
|-----|-------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` field from the JSON file |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the `private_key` field from the JSON file - paste it exactly as it appears (with the `-----BEGIN PRIVATE KEY-----` lines and `\n`s included) |
| `WAITLIST_SHEET_ID` | `1xMOZzMmEfPjloOt-fto1-84EuKO0YgFk5oClNBHL7PQ` |

Trigger a redeploy (Netlify → Deploys → Trigger deploy) - functions read
environment variables at deploy time.

## Test it

Use the "Join the waiting list" link from a test quote email (or build one
by hand - see `waitlist.js` for the URL format) and confirm the signup.
Check the sheet for a new row within a few seconds. If nothing appears,
check the function logs (Netlify → Functions → waitlist) for a "Sheets
append error" or "Google token error" message - it'll usually say exactly
what's wrong (sheet not shared with the service account, wrong key, etc).

## Known limitation

Rows are added when someone joins the list, but not updated afterwards -
if `waitlist-notify.js` later emails them because a unit freed up, the
sheet's "Status" column still says "waiting" rather than flipping to
"notified" (the admin viewer at `/.netlify/functions/waitlist-list` always
shows the live status, so that's the source of truth for that). Ask if
you'd like this closed the gap - it's a bigger change since it means
finding and updating one specific row rather than just appending.
