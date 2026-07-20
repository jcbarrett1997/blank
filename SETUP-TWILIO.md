# Automated SMS payment reminders — setup guide

Sends a single SMS reminder via Twilio to any customer whose MB Storage
invoice is 5 days overdue (Batley and Liversedge only, using the QuickBooks
connections already set up — see SETUP-QUICKBOOKS.md).

Nothing secret lives in this repository — every credential is stored on Netlify.

---

## How it works

Once a day (`netlify/functions/payment-reminders.js`, scheduled 11am UTC in
`netlify.toml`), the function:

1. Asks QuickBooks (for each of Batley and Liversedge) for open invoices
   whose due date was exactly 5 days ago.
2. Looks up the phone number on that invoice's QuickBooks customer record.
3. Texts them one reminder via Twilio.
4. Remembers it's sent (in Netlify Blobs) so it's never sent twice, even if
   the function runs again.

If an invoice's customer has no usable phone number on file, that one is
skipped (logged, not a failure) — everything else still goes out.

## Step 1 — Twilio account

1. Sign up at **https://www.twilio.com** (or log in if you already have one).
2. **Buy a phone number** capable of sending SMS to UK numbers (Console →
   Phone Numbers → Buy a number). A UK number is usually best for
   deliverability/cost, but a Twilio US number works too.
3. From the Console dashboard, copy your **Account SID** and **Auth Token**.

## Step 2 — Netlify environment variables

In **Site settings → Environment variables**, add:

| Key | Value |
|-----|-------|
| `TWILIO_ACCOUNT_SID` | your Account SID |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_FROM_NUMBER` | the Twilio number you bought, in `+447...` / `+1...` format |
| `REMINDER_DAYS_AFTER_DUE` | optional — how many days after the due date to text (default `5`) |

**Deploy.** The function will start running on its daily schedule immediately;
until these three Twilio variables are set it safely does nothing (logs
"not configured" and exits).

## Testing

- Netlify functions can be triggered manually by visiting
  `https://www.mbstorage.co.uk/.netlify/functions/payment-reminders` in a
  browser (POST-only endpoints aside — this one runs on GET too, since it
  takes no input).
- Check **Netlify → Functions → payment-reminders → Logs** for what it found
  and sent. With nothing overdue by exactly 5 days, it'll log "nothing due"
  and that's expected — it only fires for invoices that hit that exact age
  on that day's run.
- To test the SMS itself without waiting for a real overdue invoice, you can
  temporarily create a test invoice in QuickBooks dated so its due date
  lands 5 days before today, with your own phone number on the test
  customer record, then trigger the function manually.

## Changing the message or timing

- Message wording lives in the `body` variable inside
  `netlify/functions/payment-reminders.js`.
- Reminder timing (days after due) is `REMINDER_DAYS_AFTER_DUE` above — no
  code change needed.
- Schedule (what time of day it runs) is the cron line in `netlify.toml`
  under `[functions."payment-reminders"]`.

## Notes

- This currently only covers MB Storage's monthly rent invoices raised in
  QuickBooks (and the automatic upfront 6/12-month invoices) — it reads
  whatever QuickBooks shows as open and overdue, so it works for either.
- Phone numbers come from the QuickBooks customer record, which is
  populated from what the customer entered at booking. If a customer's
  number is missing or malformed there, update it directly in QuickBooks.
