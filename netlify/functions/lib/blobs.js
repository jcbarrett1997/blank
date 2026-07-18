/*
 * Generic Netlify Blobs store helper, with the same explicit siteID/token
 * fallback as qb-store.js (some Netlify accounts don't auto-inject the
 * Blobs context into Functions - BLOBS_SITE_ID / BLOBS_TOKEN fix that).
 */

var { getStore } = require('@netlify/blobs');

function store(name) {
  var opts = { name: name, consistency: 'strong' };
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    opts.siteID = process.env.BLOBS_SITE_ID;
    opts.token = process.env.BLOBS_TOKEN;
  }
  return getStore(opts);
}

module.exports = { store: store };
