# Invoice Check sheet automation (QuickBooks -> marked PAID)

Two automations for the "Invoice Check" Google Sheet:

1. **Payments mark themselves.** Every hour, the website asks each
   connected QuickBooks company (Batley, Liversedge, Brighouse/JB) for
   invoices that became fully paid, and marks the matching rows PAID in
   the current month's tab. Multi-unit customers ("Tahir Sultan 2") are
   matched by their base name, so one payment ticks all their rows.
2. **The monthly tab makes itself.** Five days before the end of the
   month, next month's tab is created automatically: customers carried
   over, Paid Status cleared - except prepaid customers (Time Remaining
   "Ends ..." dates still in the future), who are pre-marked PAID. You
   get a summary email listing who was carried as prepaid and whose
   prepaid period has just ended.

Name mismatches ("QuickBooks says John Smith, sheet says Johnny") are
emailed to you once and listed in an UNMATCHED LOG tab; add a row to the
MAPPING tab (QuickBooks name -> sheet name) and that customer matches
automatically forever after.

## 1. Install the Apps Script in the Invoice Check sheet

1. Open the **Invoice Check** sheet → **Extensions → Apps Script**.
2. Delete any existing code and paste the whole of
   `apps-script/invoice-check-automation.gs` (also provided in chat).
3. At the top, change `SECRET = 'CHANGE_ME_TO_MATCH_NETLIFY'` to a
   password you make up.
4. Save (Ctrl+S).

## 2. Deploy it as a web app

1. **Deploy → New deployment → (gear icon) Web app**
2. Description: anything. **Execute as: Me**. **Who has access: Anyone.**
   ("Anyone" is safe here - every request must carry your secret, and the
   URL itself is long and unguessable.)
3. **Deploy**, authorise when asked, and **copy the Web app URL**
   (ends in `/exec`).

## 3. Install the triggers

In the function dropdown pick **installTriggers** → **Run**. This sets up
the daily checks (tab creation 5 days before month end; tab rollover on
the 1st) and records the current month's tab name.

## 4. Netlify variables

Add to Netlify → Environment variables, then **Trigger deploy**:

- `INVOICE_SHEET_WEBAPP_URL` = the web app URL from step 2
- `INVOICE_SHEET_SECRET` = the secret from step 1 (mark as secret)

The hourly sync (`qb-paid-sync`) starts running automatically - it's
scheduled in `netlify.toml`.

## 5. Connect Brighouse (JB Storage Solutions) to QuickBooks

So the Brighouse section marks itself too, connect JB's QuickBooks the
same way as the other two (sign in with JB's own QuickBooks login,
ideally in a private window):

```
https://www.mbstorage.co.uk/.netlify/functions/qb-connect?site=brighouse&key=YOUR_SETUP_KEY
```

No item or VAT code IDs are needed for Brighouse - it only uses the
connection for reading paid invoices, not creating anything.

## 6. Test it

- **Payment marking:** receive (or record) a payment against an invoice
  in any connected QuickBooks, wait for the next hourly run (or watch
  Netlify → Logs → Functions → `qb-paid-sync`), and check the customer's
  row turns PAID in the current tab.
- **Unmatched flow:** any name it can't match appears once in an email
  and in the UNMATCHED LOG tab - add a MAPPING row and it self-heals.
- **Tab creation:** don't wait until month end - in the Apps Script
  editor, run **createNextMonthTab** manually once and check the new tab
  looks right (prepaid customers PAID, everyone else cleared, section
  headers clean). Delete the test tab afterwards if you like; it will be
  recreated on schedule.

## How "current tab" is decided

Tab names follow the "July 26" convention. The script tracks which tab
payments should be marked in: the new month's tab is created 5 days
early, but payments keep going to the old month's tab until the 1st,
when marking rolls over automatically.

## Notes and limits

- Rows are only ever changed from blank to PAID - the automation never
  un-marks anything a human has written.
- Cash payments aren't in QuickBooks as paid invoices, so those stay
  manual (as do any invoices you never record as paid in QuickBooks -
  the sheet mirrors QuickBooks, it doesn't replace it).
- The sheet's Amount Due column isn't checked or changed - marking is
  driven purely by QuickBooks saying the invoice balance is zero.
