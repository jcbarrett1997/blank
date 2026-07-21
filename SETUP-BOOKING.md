# Online booking setup (Stripe + availability sheet)

Online booking stays **dormant until configured** - the page is live, but
anyone submitting is told booking isn't available yet and pointed to the
quote form / phone. To switch it on, complete the three parts below.

## How booking reaches customers (email-first funnel)

Customers should only be asked to pay a deposit AFTER they know their
price, so the booking page is deliberately NOT linked from the public site.
Instead, once `BOOKING_LIVE=true` is set in Netlify, every quote email
includes a **"Book online now"** button that links to the booking page with
the customer's size, site and details pre-filled. Quote → price in inbox →
book from the email. Until that flag is set, quote emails stick to
reply / call / WhatsApp.

Batley and Liversedge are **separate companies with separate bank accounts**,
so each has its own Stripe account and the site routes each booking's payment
to the right one automatically.

## 1. Stripe accounts (one per company)

For **each** company (Batley company, Liversedge company):

1. Sign up at https://stripe.com (business details + the company's bank account).
2. In the Stripe dashboard: **Developers → API keys** → copy the **Secret key**
   (starts `sk_live_...`; while testing use the test key `sk_test_...`).
3. In Netlify → Site configuration → Environment variables, add:
   - `STRIPE_SECRET_KEY_BATLEY` = the Batley company's secret key
   - `STRIPE_SECRET_KEY_LIVERSEDGE` = the Liversedge company's secret key

## 2. Webhooks (so the site knows a deposit was paid)

In **each** Stripe dashboard: **Developers → Webhooks → Add endpoint**

- Endpoint URL: `https://www.mbstorage.co.uk/.netlify/functions/stripe-webhook`
- Event to send: `checkout.session.completed`
- After creating it, copy the **Signing secret** (starts `whsec_...`) and add
  to Netlify:
  - `STRIPE_WEBHOOK_SECRET_BATLEY` = signing secret from the Batley account
  - `STRIPE_WEBHOOK_SECRET_LIVERSEDGE` = signing secret from the Liversedge account

The webhook sends the customer their booking confirmation email and sends
MB Storage an urgent "deposit paid" notification (using the existing
Mailgun/Resend email settings).

## 3. Availability sheet (optional but recommended)

1. Create a Google Sheet with exactly these columns (row 1 = headers):

   | site       | size | units_free |
   |------------|------|------------|
   | Batley     | 20ft | 3          |
   | Batley     | 8ft  | 2          |
   | Liversedge | 20ft | 5          |

2. In Google Sheets: **File → Share → Publish to web** → choose the sheet,
   format **CSV** → Publish → copy the URL.
3. Add to Netlify: `AVAILABILITY_SHEET_CSV_URL` = that URL.

Update `units_free` whenever someone moves in or out (works fine from the
Sheets phone app). The site shows "Available now" / "Only N left" / "full"
and blocks bookings for anything at 0. If the sheet is unreachable the site
fails soft - booking still works, badges just don't show.

## 4. Waiting list (automatic, needs nothing extra configured)

When a quote email finds a size/site sold out, it offers a "Join the
waiting list" button (`netlify/functions/waitlist.js`, stored in Netlify
Blobs). Every 2 hours, `waitlist-notify.js` checks the same availability
sheet above and emails anyone whose size/site has since freed up - each
person is only ever emailed once. Uses the same email provider config as
the rest of the site, and reads directly from the availability sheet, so
there's nothing new to set up as long as section 3 above is done.

## After adding/changing any variables

Trigger a redeploy (Netlify → Deploys → Trigger deploy) - functions read
environment variables at deploy time.

## Test before going live

Use each Stripe account's **test mode** key + webhook first: book with card
number `4242 4242 4242 4242` (any future expiry/CVC). Check the confirmation
email, the internal notification, and the payment in the Stripe dashboard.
Then swap to the live keys and redeploy.

## Go-live checklist

1. Both companies verified by Stripe; live secret keys in Netlify
2. Webhook destinations created in **live mode**, live signing secrets in Netlify
3. Availability sheet published and `AVAILABILITY_SHEET_CSV_URL` set
4. Set `BOOKING_LIVE=true` in Netlify - this adds the "Book online now"
   button to quote emails
5. Remove the "final testing" banner from book.html
6. Trigger deploy, request a real quote, book from the email with a real
   card, then refund yourself in the Stripe dashboard

## What is charged

One payment at booking, calculated server-side in `netlify/functions/book.js`:

- **Refundable deposit**: £150 (20ft) / £75 (8ft)
- **First rent payment**: pro-rata (daily rate) from the move-in date to the
  end of that month, plus VAT. If the move-in date is within 7 days of the
  month end, the following month is included too, so the customer isn't
  invoiced again days after paying.

Paying in full at booking means a unit is only ever held by cleared money -
there is no invoice-chase window and no double-booking race on the last
unit. Raise the matching first invoice in QuickBooks marked as paid; rent
is invoiced monthly on the 1st thereafter.
