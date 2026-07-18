/*
 * MB Storage - start a QuickBooks Online connection for one company.
 *
 * Visit once per company to set up (or reconnect if a connection ever
 * needs refreshing from scratch):
 *   /.netlify/functions/qb-connect?site=batley&key=YOUR_SETUP_KEY
 *   /.netlify/functions/qb-connect?site=liversedge&key=YOUR_SETUP_KEY
 *
 * Sign in with that company's own QuickBooks login when Intuit asks.
 * See SETUP-QUICKBOOKS.md for the full walkthrough.
 */

var qb = require('./lib/quickbooks');

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var site = (params.site || '').toLowerCase();
  if (site !== 'batley' && site !== 'liversedge' && site !== 'brighouse') {
    return { statusCode: 400, body: 'Add ?site=batley, ?site=liversedge or ?site=brighouse to the URL.' };
  }

  var setupKey = process.env.QUICKBOOKS_SETUP_KEY;
  if (setupKey && params.key !== setupKey) {
    return { statusCode: 403, body: 'Missing or incorrect ?key= - check QUICKBOOKS_SETUP_KEY in Netlify.' };
  }

  if (!qb.configured()) {
    return { statusCode: 500, body: 'QuickBooks is not configured yet - set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in Netlify first.' };
  }
  var redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  if (!redirectUri) {
    return { statusCode: 500, body: 'QUICKBOOKS_REDIRECT_URI is not set in Netlify.' };
  }

  var state = site + ':' + Math.random().toString(36).slice(2);
  return { statusCode: 302, headers: { Location: qb.authorizeUrl(redirectUri, state) } };
};
