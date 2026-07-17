# QuickBooks Online setup (automatic sales receipt on payment)

When a customer pays online (deposit + first rent, via Stripe), the site
now automatically records that sale in the right QuickBooks Online company
(Batley or Liversedge) as a **Sales Receipt** - the correct QuickBooks
object for money already received, as opposed to an Invoice (money still
owed). No more manually copying Stripe payments into QuickBooks for
monthly-paying online bookings.

**Stripe is unchanged** - it still takes the card payment exactly as
before. This only automates the bookkeeping step afterwards.

**Not covered:** the 6/12-month upfront bookings (no card is taken for
those - see the existing "upfront booking request" email flow), and your
ongoing monthly invoices from month 2 onwards, which you continue to raise
in QuickBooks as normal.

Like the rest of the site's integrations, this stays **dormant until
configured** - nothing breaks if you don't set it up, and no customer
sees anything different either way.

## 1. Create an Intuit developer app (one app serves both companies)

1. Go to https://developer.intuit.com and sign in (or create an account).
2. **Create an app** → choose the QuickBooks Online and Payments API.
3. Under the app's **Keys & OAuth** settings, copy the **Client ID** and
   **Client Secret** (there are separate Development and Production keys -
   start with Development for sandbox testing).
4. Under **Redirect URIs**, add:
   ```
   https://www.mbstorage.co.uk/.netlify/functions/qb-callback
   ```

## 2. Add the base settings to Netlify

Site configuration → Environment variables → add:

- `QUICKBOOKS_CLIENT_ID` = the Client ID (mark as secret)
- `QUICKBOOKS_CLIENT_SECRET` = the Client Secret (mark as secret)
- `QUICKBOOKS_REDIRECT_URI` = `https://www.mbstorage.co.uk/.netlify/functions/qb-callback`
- `QUICKBOOKS_ENVIRONMENT` = `sandbox` (switch to `production` once you've
  tested and are ready to go live)
- `QUICKBOOKS_SETUP_KEY` = a password you make up, e.g. a random phrase -
  this protects the connect/setup links below from being triggered by
  anyone else who finds the URL

Trigger a deploy so these are picked up.

### If you see "The environment has not been configured to use Netlify Blobs..."

Some Netlify accounts don't automatically wire up Blobs (the private
storage used to hold the QuickBooks connection) inside Functions. If the
connect step below fails with that message, add two more variables:

- `BLOBS_SITE_ID` - Netlify → Site configuration → General → Site details
  → **Site ID** (looks like a long code, not the site name)
- `BLOBS_TOKEN` - Netlify → click your account/avatar → **User settings**
  → **Applications** → **Personal access tokens** → **New access token**
  (give it a name like "MB Storage Blobs", copy the token - mark it secret
  in Netlify)

Trigger another deploy, then retry the connect step.

## 3. Create two items in each QuickBooks company

In **both** the Batley and the Liversedge QuickBooks Online company,
create two Products/Services (Sales → Products and Services → New):

- **Storage Deposit**
- **Storage Rent**

The amounts the site sends already include VAT collected via Stripe -
**check with your bookkeeper/accountant** how these two items should be
set up for VAT/sales tax in QuickBooks so nothing is double-counted.

## 4. Connect each company

Visit (replace `YOUR_SETUP_KEY` with what you set in step 2):

```
https://www.mbstorage.co.uk/.netlify/functions/qb-connect?site=batley&key=YOUR_SETUP_KEY
```

Sign in with **Batley's** QuickBooks login when Intuit asks, and approve
the connection. You'll land on a "QuickBooks connected for batley" page.

Repeat for Liversedge, signing in with **Liversedge's** own QuickBooks
login:

```
https://www.mbstorage.co.uk/.netlify/functions/qb-connect?site=liversedge&key=YOUR_SETUP_KEY
```

## 5. Find and set the item IDs

Visit:

```
https://www.mbstorage.co.uk/.netlify/functions/qb-list-items?site=batley&key=YOUR_SETUP_KEY
```

This lists every product/service in Batley's QuickBooks with its ID.
Find "Storage Deposit" and "Storage Rent" and copy their IDs into Netlify:

- `QUICKBOOKS_BATLEY_DEPOSIT_ITEM_ID`
- `QUICKBOOKS_BATLEY_RENT_ITEM_ID`

Repeat with `?site=liversedge` for:

- `QUICKBOOKS_LIVERSEDGE_DEPOSIT_ITEM_ID`
- `QUICKBOOKS_LIVERSEDGE_RENT_ITEM_ID`

## 5b. Find and set the VAT code IDs (required for UK companies)

UK QuickBooks companies reject any sale without a VAT code on every line
("Business Validation Error: Make sure all your transactions have a VAT
rate before you save"), so each line needs a VAT code. Visit:

```
https://www.mbstorage.co.uk/.netlify/functions/qb-list-taxcodes?site=batley&key=YOUR_SETUP_KEY
```

This lists the company's VAT codes with their IDs. The typical UK choice
(confirm with your bookkeeper):

- `QUICKBOOKS_BATLEY_RENT_TAX_CODE_ID` = the ID of **"20.0% S"** - the
  rent amounts already include 20% VAT collected via Stripe, and the
  receipt is marked VAT-inclusive so QuickBooks works the VAT backwards
  from the gross figure
- `QUICKBOOKS_BATLEY_DEPOSIT_TAX_CODE_ID` = the ID of **"No VAT"** -
  refundable deposits are typically outside the scope of VAT

Repeat with `?site=liversedge` for:

- `QUICKBOOKS_LIVERSEDGE_RENT_TAX_CODE_ID`
- `QUICKBOOKS_LIVERSEDGE_DEPOSIT_TAX_CODE_ID`

Trigger a deploy again.

## 6. Test it

With `QUICKBOOKS_ENVIRONMENT=sandbox`, make a real (or Stripe test-mode)
booking and check:

- A new **Sales Receipt** appears automatically in the correct company's
  QuickBooks sandbox, with the customer, the deposit line, the rent line
  (labelled with the period, e.g. "First rent payment (17-31 July)"), and
  a note referencing the Stripe payment.
- If it doesn't appear, check Netlify → Logs → Functions → `stripe-webhook`
  for a line starting `QuickBooks sync failed:` - it will say exactly what
  went wrong (not connected, item IDs missing, etc.). The booking and its
  confirmation emails are never affected by a QuickBooks failure - this
  step is isolated on purpose.

## 7. Go live

1. Get your **Production** Client ID/Secret from the Intuit app (Keys &
   OAuth → Production keys) and update `QUICKBOOKS_CLIENT_ID` /
   `QUICKBOOKS_CLIENT_SECRET` in Netlify.
2. Set `QUICKBOOKS_ENVIRONMENT=production`.
3. Redo step 4 (connect) for both companies - production is a separate
   connection from sandbox.
4. Redo step 5 (item IDs) - production item IDs are different from the
   sandbox ones you looked up earlier.
5. Trigger a deploy, then do one real booking and confirm the Sales
   Receipt lands correctly in the live QuickBooks company.

## Reconnecting later

QuickBooks connections are refreshed automatically in the background each
time a payment comes in, so day-to-day nothing needs touching. If a
connection ever does lapse (e.g. after months of no bookings on one site),
just repeat step 4 for that company.
