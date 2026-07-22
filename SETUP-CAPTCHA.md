# Spam protection (Cloudflare Turnstile) - setup guide

Adds a free, privacy-friendly CAPTCHA to the contact form to cut down on
spam submissions. Cloudflare Turnstile is usually invisible to real
visitors (no puzzle-solving) - it just runs a background check.

## Step 1 - Create a Turnstile widget

1. Go to **https://dash.cloudflare.com** (free account is fine, no domain
   needs to be on Cloudflare for this).
2. In the sidebar, go to **Turnstile** → **Add widget**.
3. Domain: `mbstorage.co.uk` (and `www.mbstorage.co.uk`).
4. Widget mode: **Managed** (recommended - shows a checkbox only if it's
   unsure about the visitor).
5. Create it, then copy the **Site Key** and **Secret Key**.

## Step 2 - Add the Site Key to the page

The Site Key is safe to be public (it's meant to be visible in the page
source). Open `contact.html` and replace `TURNSTILE_SITE_KEY` with your
real Site Key:

```html
<div class="cf-turnstile" data-sitekey="TURNSTILE_SITE_KEY"></div>
```

## Step 3 - Add the Secret Key to Netlify

In **Netlify → Site settings → Environment variables**, add:

| Key | Value |
|-----|-------|
| `TURNSTILE_SECRET_KEY` | your Secret Key from Cloudflare |

Deploy. Until both the Site Key (in the HTML) and `TURNSTILE_SECRET_KEY`
(in Netlify) are set, the form works exactly as before - the check is
skipped rather than blocking real customers.

## How it works

- The widget silently runs a check and adds a hidden `cf-turnstile-response`
  field to the form when it submits.
- `netlify/functions/contact.js` verifies that token against Cloudflare's
  API before sending any email. Submissions that fail are rejected with a
  friendly error - nothing is emailed.
- The existing honeypot field (`_honey`) still runs first and catches the
  simplest bots for free, so Turnstile is a second layer on top.

## Extending to other forms

Only `contact.html` has the widget right now. If spam starts showing up
on the quote form too, the same three steps apply to `quote.html` /
`quote.js` - just add the same `<div class="cf-turnstile">` and a matching
`verifyTurnstile()` check (copy the one in `contact.js`).
