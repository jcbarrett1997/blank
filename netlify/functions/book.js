/*
 * MB Storage - online booking (Netlify Function)
 *
 * Takes a booking request, re-checks availability server-side, then creates
 * a Stripe Checkout session for the refundable deposit and returns its URL
 * for the browser to redirect to. Payment confirmation (emails etc.) is
 * handled by stripe-webhook.js when Stripe tells us the payment succeeded.
 *
 * Batley and Liversedge are separate companies with separate bank accounts,
 * so each has its own Stripe account - the key is chosen by site:
 *
 *   STRIPE_SECRET_KEY_BATLEY       Stripe secret key for the Batley company
 *   STRIPE_SECRET_KEY_LIVERSEDGE   Stripe secret key for the Liversedge company
 *   AVAILABILITY_SHEET_CSV_URL     published-CSV URL of the availability sheet
 *   SITE_URL                       e.g. "https://www.mbstorage.co.uk"
 *
 * Nothing is configured in the repo - all keys live in Netlify env vars.
 */

var SITE = (process.env.SITE_URL || 'https://www.mbstorage.co.uk').replace(/\/$/, '');

/* Deposits (in pence). Server-side only - never trusted from the browser. */
var DEPOSITS = {
  '20ft': { label: '20ft × 8ft storage container', pence: 15000 },
  '8ft':  { label: '8ft × 6ft 6in storage container', pence: 7500 }
};

var SITES = {
  batley:     { label: 'Batley',     keyEnv: 'STRIPE_SECRET_KEY_BATLEY' },
  liversedge: { label: 'Liversedge', keyEnv: 'STRIPE_SECRET_KEY_LIVERSEDGE' }
};

function json(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function unitsFree(site, size) {
  var url = process.env.AVAILABILITY_SHEET_CSV_URL;
  if (!url) return null; // availability not configured - don't block bookings on it
  try {
    var r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    var rows = (await r.text()).split(/\r?\n/).map(function (l) {
      return l.split(',').map(function (c) { return c.replace(/^"|"$/g, '').trim().toLowerCase(); });
    });
    var head = rows[0], iSite = head.indexOf('site'), iSize = head.indexOf('size'), iFree = head.indexOf('units_free');
    if (iSite === -1 || iSize === -1 || iFree === -1) return null;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][iSite] === site && rows[i][iSize] === size) return parseInt(rows[i][iFree], 10);
    }
  } catch (e) { console.error(e); }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  var d;
  try { d = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'Bad request' }); }

  // Honeypot - silently succeed for bots
  if (d._honey || d.company) return json(200, { ok: true });

  var site = SITES[(d.site || '').toLowerCase()];
  var unit = DEPOSITS[d.container_size];
  if (!site) return json(400, { ok: false, error: 'Please choose a site.' });
  if (!unit) return json(400, { ok: false, error: 'Please choose a container size.' });
  if (d.container_size === '8ft' && (d.site || '').toLowerCase() !== 'batley') {
    return json(400, { ok: false, error: '8ft containers are available at our Batley site only.' });
  }
  if (!d.name || !String(d.name).trim()) return json(400, { ok: false, error: 'Please tell us your name.' });
  if (!d.email || String(d.email).indexOf('@') === -1) return json(400, { ok: false, error: 'A valid email is required.' });
  if (!d.phone || !String(d.phone).trim()) return json(400, { ok: false, error: 'A phone number is required.' });
  if (d.terms_agreed !== 'yes' && d.terms_agreed !== 'on' && d.terms_agreed !== true) {
    return json(400, { ok: false, error: 'Please confirm you agree to our Terms & Conditions.' });
  }

  // Bookings are only taken up to 3 days ahead - we can't guarantee
  // availability further out (browser enforces this too; this is the backstop)
  if (d.move_in_date) {
    var picked = new Date(d.move_in_date + 'T12:00:00');
    var latest = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    latest.setHours(23, 59, 59, 999);
    var earliest = new Date(); earliest.setHours(0, 0, 0, 0);
    if (isNaN(picked.getTime()) || picked > latest || picked < earliest) {
      return json(400, { ok: false, error: 'Bookings can be made up to 3 days in advance. For later move-in dates, please get a quote and we\'ll pencil you in.' });
    }
  }

  var key = process.env[site.keyEnv];
  if (!key) return json(503, { ok: false, error: 'Online booking is not available just yet. Please use the quote form or call 07375 355233.' });

  // Availability re-check (authoritative, server-side)
  var free = await unitsFree((d.site || '').toLowerCase(), d.container_size);
  if (free !== null && free <= 0) {
    return json(409, { ok: false, error: 'Sorry - that size has just sold out at ' + site.label + '. Call us on 07375 355233 and we\'ll help.' });
  }

  // Create the Stripe Checkout session (form-encoded REST call - no SDK needed)
  var form = new URLSearchParams();
  form.append('mode', 'payment');
  form.append('line_items[0][quantity]', '1');
  form.append('line_items[0][price_data][currency]', 'gbp');
  form.append('line_items[0][price_data][unit_amount]', String(unit.pence));
  form.append('line_items[0][price_data][product_data][name]', 'Refundable deposit - ' + unit.label + ' (' + site.label + ')');
  form.append('line_items[0][price_data][product_data][description]', 'Refunded in full when you leave, provided the unit is left as found.');
  form.append('customer_email', String(d.email).trim());
  form.append('success_url', SITE + '/booking-confirmed.html');
  form.append('cancel_url', SITE + '/book.html');
  form.append('payment_intent_data[description]', 'MB Storage deposit - ' + unit.label + ' at ' + site.label);
  ['name', 'phone', 'move_in_date', 'storing'].forEach(function (k) {
    if (d[k]) form.append('metadata[' + k + ']', String(d[k]).slice(0, 450));
  });
  form.append('metadata[site]', site.label);
  form.append('metadata[container_size]', d.container_size);
  form.append('metadata[terms_agreed]', 'yes - ' + new Date().toISOString());

  try {
    var r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    var session = await r.json();
    if (!r.ok) { console.error('Stripe error:', JSON.stringify(session)); return json(502, { ok: false, error: 'Could not start payment. Please try again or call 07375 355233.' }); }
    return json(200, { ok: true, url: session.url });
  } catch (err) {
    console.error(err);
    return json(502, { ok: false, error: 'Could not start payment. Please try again or call 07375 355233.' });
  }
};
