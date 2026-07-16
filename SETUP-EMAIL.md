# Instant quote emails — setup guide

The quote form emails each customer their price **from `@mbstorage.co.uk`** using
**Mailgun** (email delivery) + a **Netlify serverless function** (which calculates
the price server-side, so prices are never exposed in the website code).

> The functions are **provider-agnostic** — they work with **Mailgun _or_ Resend**
> depending on which environment variables you set in Netlify. Set the Mailgun
> variables (below) to use Mailgun, or set `RESEND_API_KEY` instead to use Resend.
> No code change either way.

Nothing secret lives in this repository — the API key is stored on Netlify.

---

## Overview of what happens

1. Customer submits the quote form → posts to `/.netlify/functions/quote`.
2. The function (`netlify/functions/quote.js`) works out the price, then sends:
   - a **branded HTML quote** to the customer (from `quotes@staging.mbstorage.co.uk`),
   - a **notification** to `info@mbstorage.co.uk`.
3. Customer lands on `thank-you.html`.

---

## Step 1 — Mailgun sending domain

You already have a Mailgun sending domain (`staging.mbstorage.co.uk`), which today
only sends your **old** website's contact-form emails. Once this new site replaces
the old one, that usage stops — so Mailgun's single free-plan domain can serve the
new site.

- **To test right now:** you can use the existing **`staging.mbstorage.co.uk`**
  domain as-is (it's already verified). The only downside is the customer sees the
  sender as `quotes@staging.mbstorage.co.uk`, which reads as a test address.
- **For go-live (cleaner sender):** once the old site is retired, in Mailgun delete
  `staging.mbstorage.co.uk` and **Add New Domain → `mg.mbstorage.co.uk`**, add the
  DNS records it lists (all on the `mg.` subdomain, so your inbox is untouched),
  verify, and update `MAILGUN_DOMAIN` + `MAIL_FROM` (below). Sender becomes
  `quotes@mg.mbstorage.co.uk`.

> Whichever domain you use, set `MAILGUN_DOMAIN` and `MAIL_FROM` to match it.

## Step 2 — Mailgun API key + region

1. In Mailgun → **API keys** → copy your **Sending API key**.
2. Note your **region** (US or EU) — it decides `MAILGUN_API_BASE` below.
3. You'll paste the key into Netlify next — **do not** put it in the repository.

## Step 3 — Netlify (hosts the site + the function)

1. Sign up at **https://netlify.com** → **Add new site → Import from Git** →
   choose this GitHub repo and the branch.
   (No build command needed; `netlify.toml` already points the publish folder and
   functions folder.)
2. In **Site settings → Environment variables**, add:

   | Key | Value |
   |-----|-------|
   | `MAILGUN_API_KEY` | the Sending API key from Step 2 |
   | `MAILGUN_DOMAIN` | `staging.mbstorage.co.uk` (for now) — later `mg.mbstorage.co.uk` |
   | `MAILGUN_API_BASE` | `https://api.eu.mailgun.net` **(only if your region is EU)** — otherwise omit |
   | `MAIL_FROM` | `MB Storage <quotes@staging.mbstorage.co.uk>` — later `…@mg.mbstorage.co.uk` |
   | `MAIL_TO` | `info@mbstorage.co.uk` |
   | `SITE_URL` | `https://mbstorage.netlify.app` (while testing) — later `https://www.mbstorage.co.uk` |

3. **Deploy**. Your site goes live on a `*.netlify.app` URL immediately, and the
   quote form works as soon as your Mailgun domain is verified.

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
  Mailgun domain not being verified, or missing `MAILGUN_API_KEY` / `MAILGUN_DOMAIN`.

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
