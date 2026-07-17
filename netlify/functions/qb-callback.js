/*
 * MB Storage - QuickBooks OAuth callback.
 *
 * Intuit redirects here after the user approves the connection in
 * qb-connect.js. Exchanges the authorization code for tokens and stores
 * them (in Netlify Blobs) against the company encoded in "state".
 */

var qbStore = require('./lib/qb-store');
var qb = require('./lib/quickbooks');

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var code = params.code;
  var realmId = params.realmId;
  var state = params.state || '';
  var site = state.split(':')[0];

  if (!code || !realmId || (site !== 'batley' && site !== 'liversedge')) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<h1>QuickBooks connection failed</h1><p>Missing code/realmId, or an unrecognised site. Please start again from <code>/.netlify/functions/qb-connect?site=batley</code> (or <code>liversedge</code>).</p>'
    };
  }

  try {
    var redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
    var tokens = await qb.exchangeCode(code, redirectUri);
    await qbStore.setTokens(site, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      realmId: realmId,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: '<h1>QuickBooks connected for ' + site + '</h1>' +
        '<p>Company (realm) ID: ' + realmId + '</p>' +
        '<p>You can close this tab. Next step: find your Item IDs at ' +
        '<code>/.netlify/functions/qb-list-items?site=' + site + '&key=YOUR_SETUP_KEY</code> ' +
        'and set them in Netlify - see SETUP-QUICKBOOKS.md.</p>'
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: '<h1>QuickBooks connection failed</h1><p>' + err.message + '</p>' };
  }
};
