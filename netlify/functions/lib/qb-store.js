/*
 * Small helper around Netlify Blobs for storing QuickBooks OAuth tokens.
 * One entry per company ("batley" / "liversedge"), holding the access
 * token, refresh token, QuickBooks company (realm) ID and expiry.
 *
 * Netlify Blobs is a private, encrypted-at-rest key/value store scoped to
 * this site - nothing here is publicly reachable, unlike the availability
 * Google Sheet (which is deliberately public but holds nothing sensitive).
 *
 * Some Netlify accounts don't auto-inject the Blobs context into Functions
 * ("The environment has not been configured to use Netlify Blobs..."), so
 * this falls back to explicit manual configuration when available:
 *
 *   BLOBS_SITE_ID   Site configuration -> General -> Site details -> Site ID
 *   BLOBS_TOKEN     a Personal Access Token (User settings -> Applications
 *                   -> Personal access tokens -> New access token)
 */

var { getStore } = require('@netlify/blobs');

function store() {
  var opts = { name: 'quickbooks-tokens', consistency: 'strong' };
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    opts.siteID = process.env.BLOBS_SITE_ID;
    opts.token = process.env.BLOBS_TOKEN;
  }
  return getStore(opts);
}

async function getTokens(company) {
  return store().get('qb-' + company, { type: 'json' });
}

async function setTokens(company, tokens) {
  await store().setJSON('qb-' + company, tokens);
}

module.exports = { getTokens: getTokens, setTokens: setTokens };
