# MB Storage — Website

A fast, SEO-optimised static website for [mbstorage.co.uk](https://www.mbstorage.co.uk) — self storage in Batley, Liversedge and Brighouse, West Yorkshire.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Home — hero, features, unit teasers, locations, CTAs |
| `units.html` | Products / size guide — 20ft × 8ft and 8ft × 6ft 6in containers with dimension diagrams |
| `quote.html` | **Instant quote & online booking** — price is emailed to the customer, never shown on the page |
| `locations.html` | Batley, Liversedge and Brighouse site details |
| `about.html` | About the business |
| `site-guidance.html` | Customer site rules (access, padlocks, payments, deposits, insurance) |
| `contact.html` | Phone, email, address + contact form |
| `thank-you.html` | Post-form-submission landing page (noindexed) |

## How the instant quote works

Prices are **hidden from the website** by design. The quote form (`quote.html`) posts to
[FormSubmit](https://formsubmit.co/) (`https://formsubmit.co/info@mbstorage.co.uk`):

1. The customer picks a container size, enters their details and submits.
2. `assets/js/main.js` builds a personalised quote email (monthly price ex/inc VAT,
   refundable deposit, padlock included, next steps) and injects it into FormSubmit's
   `_autoresponse` field — so **the price arrives only in the customer's inbox**.
3. MB Storage receives the enquiry (with a `quote_summary` line) at `info@mbstorage.co.uk`.
4. The customer is redirected to `thank-you.html`.

Pricing lives in one place — the `UNITS` object at the top of `assets/js/main.js`:

- 20ft × 8ft container — £160 + VAT pcm, £150 refundable deposit
- 8ft × 6ft 6in container — £82.50 + VAT pcm, £75 refundable deposit

Update prices there and the quote emails update automatically.

### One-time setup (required before go-live)

- **Activate FormSubmit**: the first time a form is submitted, FormSubmit sends a
  confirmation email to `info@mbstorage.co.uk` — click the activation link once and
  all forms work from then on. (Optionally replace the email address in the form
  `action` with the random alias FormSubmit gives you, to hide the address from bots.)
- The `_next` redirect URLs in `quote.html` / `contact.html` point at
  `https://www.mbstorage.co.uk/thank-you.html` — update if the site is hosted on a
  different domain.

## Brand

Colours are taken from the master logo (`assets/img/`):

- Green `#00A34A` (primary / CTAs)
- Navy `#1E4C6B` (headings / secondary)
- Ink `#22190A` (text / footer)

Logo files: `logo-landscape.png` (+`@4x`), `logo-portrait.png`, `favicon.png`.

## Photography

The build environment could not download images from the current live site (network
policy), so the unit cards currently use branded SVG diagrams in `assets/img/photos/`.
To use the real site photography, export the images from the current WordPress site
(Media Library → download) and drop them in `assets/img/photos/`, then update the
`<img src>` paths in `index.html`, `units.html` and `locations.html`. Recommended shots:

- Batley site overview → `batley.jpg`
- Liversedge container rows → `liversedge.jpg`
- Brighouse units → `brighouse.jpg`
- Container exterior/interior close-ups → `container-20ft.jpg`, `container-8ft.jpg`

## SEO

- Unique titles + meta descriptions per page, canonical URLs, Open Graph tags
- `schema.org` JSON-LD: `SelfStorage` business markup (home) and product `ItemList` (units)
- `sitemap.xml` + `robots.txt`
- Semantic HTML, alt text on all images, lazy-loading, no framework payload

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — deploy the folder as-is to any static host (or GitHub Pages).
