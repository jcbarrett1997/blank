# Instant quote emails — setup guide

The quote form emails each customer their price **from `@mbstorage.co.uk`** using
**Resend** (email delivery) + a **Netlify serverless function** (which calculates
the price server-side, so prices are never exposed in the website code).

Nothing secret lives in this repository — the API key is stored on Netlify.

---

## Overview of what happens

1. Customer submits the quote form → posts to `/.netlify/functions/quote`.
2. The function (`netlify/functions/quote.js`) works out the price, then sends:
   - a **branded HTML quote** to the customer (from `quotes@mbstorage.co.uk`),
   - a **notification** to `info@mbstorage.co.uk`.
3. Customer lands on `thank-you.html`.

---

## Step 1 — Resend account + verify the domain

1. Sign up at **https://resend.com** (free tier is plenty for this volume).
2. **Add Domain** → enter `mbstorage.co.uk`.
3. Resend shows a set of **DNS records**. These must be added to the
   `mbstorage.co.uk` DNS by whoever manages it. Copy the values **exactly** from
   the Resend dashboard — they're unique to your domain. They look like this:

   | Type | Name / Host | Value | Purpose |
   |------|-------------|-------|---------|
   | TXT  | `send` (or as shown) | `v=spf1 include:amazonses.com ~all` (as shown) | SPF |
   | TXT  | `resend._domainkey` (as shown) | long DKIM key (as shown) | DKIM signing |
   | MX   | `send` (as shown) | `feedback-smtp.<region>.amazonses.com` (as shown) | bounce handling |
   | TXT  | `_dmarc` (recommended) | `v=DMARC1; p=none;` | DMARC policy |

   > ⚠️ Use the **exact** names/values Resend gives you — the table above is only
   > the shape of what to expect. Send those rows to your DNS manager.
4. Once the records are live, click **Verify** in Resend (can take a few minutes
   up to a couple of hours to propagate).

## Step 2 — Resend API key

1. In Resend → **API Keys → Create API Key** (Sending access is enough).
2. Copy it (starts with `re_...`). You'll paste it into Netlify next — **do not**
   put it in the repository.

## Step 3 — Netlify (hosts the site + the function)

1. Sign up at **https://netlify.com** → **Add new site → Import from Git** →
   choose this GitHub repo and the branch.
   (No build command needed; `netlify.toml` already points the publish folder and
   functions folder.)
2. In **Site settings → Environment variables**, add:

   | Key | Value |
   |-----|-------|
   | `RESEND_API_KEY` | the `re_...` key from Step 2 |
   | `MAIL_FROM` | `MB Storage <quotes@mbstorage.co.uk>` |
   | `MAIL_TO` | `info@mbstorage.co.uk` |
   | `SITE_URL` | `https://www.mbstorage.co.uk` |

3. **Deploy**. Your site goes live on a `*.netlify.app` URL immediately, and the
   quote form works as soon as the Resend domain is verified.

## Step 4 — Point mbstorage.co.uk at Netlify (when ready to go live)

In **Netlify → Domain settings**, add `mbstorage.co.uk`. Netlify shows the exact
DNS records to use — typically:

- apex `mbstorage.co.uk` → **A** record to Netlify's load balancer (`75.2.60.5`), and
- `www` → **CNAME** to your `<your-site>.netlify.app`.

Hand those to your DNS manager. Netlify then issues a free HTTPS certificate.
(Until you switch this, keep testing on the `*.netlify.app` URL.)

---

## Testing

- On the deployed Netlify URL, submit the quote form with your own email.
- You should receive the branded quote; `info@mbstorage.co.uk` gets the enquiry.
- If it fails, check **Netlify → Functions → quote → logs**. The usual cause is the
  Resend domain not being verified yet, or a missing `RESEND_API_KEY`.

## Changing prices later

Prices live in **one place**: the `UNITS` object at the top of
`netlify/functions/quote.js`. Edit, commit, push — Netlify redeploys automatically.

```js
var UNITS = {
  '20ft': { ... pcmExVat: 160.00, deposit: 150.00 ... },
  '8ft':  { ... pcmExVat: 82.50,  deposit: 75.00  ... }
};
```

## Notes

- The **contact form** (`contact.html`) uses the same setup — it posts to
  `/.netlify/functions/contact`, emails the message to `info@mbstorage.co.uk`,
  and sends the sender a branded acknowledgement, all from your domain. It uses
  the same environment variables, so no extra config is needed.
- On **GitHub Pages** the quote and contact forms won't send (no serverless
  functions there) — the functions only run on Netlify. The rest of the site
  previews fine anywhere.
