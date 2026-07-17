/*
 * Small helper around Netlify Blobs for storing QuickBooks OAuth tokens.
 * One entry per company ("batley" / "liversedge"), holding the access
 * token, refresh token, QuickBooks company (realm) ID and expiry.
 *
 * Netlify Blobs is a private, encrypted-at-rest key/value store scoped to
 * this site - nothing here is publicly reachable, unlike the availability
 * Google Sheet (which is deliberately public but holds nothing sensitive).
 */

var { getStore } = require('@netlify/blobs');

function store() {
  return getStore({ name: 'quickbooks-tokens', consistency: 'strong' });
}

async function getTokens(company) {
  return store().get('qb-' + company, { type: 'json' });
}

async function setTokens(company, tokens) {
  await store().setJSON('qb-' + company, tokens);
}

module.exports = { getTokens: getTokens, setTokens: setTokens };
