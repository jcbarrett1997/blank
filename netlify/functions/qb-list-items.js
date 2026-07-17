/*
 * MB Storage - list QuickBooks Products/Services and their IDs, so you can
 * copy the right ones into QUICKBOOKS_<SITE>_DEPOSIT_ITEM_ID / _RENT_ITEM_ID.
 *
 * Visit after connecting a company (qb-connect.js):
 *   /.netlify/functions/qb-list-items?site=batley&key=YOUR_SETUP_KEY
 */

var qb = require('./lib/quickbooks');

exports.handler = async function (event) {
  var params = event.queryStringParameters || {};
  var site = (params.site || '').toLowerCase();
  if (site !== 'batley' && site !== 'liversedge') {
    return { statusCode: 400, body: 'Add ?site=batley or ?site=liversedge to the URL.' };
  }
  var setupKey = process.env.QUICKBOOKS_SETUP_KEY;
  if (setupKey && params.key !== setupKey) {
    return { statusCode: 403, body: 'Missing or incorrect ?key=' };
  }

  try {
    var result = await qb.qbRequest(site, 'GET', 'query?query=' + encodeURIComponent('select Id, Name, Type from Item'));
    var items = (result.QueryResponse && result.QueryResponse.Item) || [];
    var lines = items.map(function (i) { return i.Id + '  -  ' + i.Name + '  (' + i.Type + ')'; });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: lines.length
        ? lines.join('\n') + '\n\nCopy the IDs for your "Storage Deposit" and "Storage Rent" items into QUICKBOOKS_' + site.toUpperCase() + '_DEPOSIT_ITEM_ID and QUICKBOOKS_' + site.toUpperCase() + '_RENT_ITEM_ID in Netlify.'
        : 'No items found - create a "Storage Deposit" and a "Storage Rent" product/service in this QuickBooks company first, then reload this page.'
    };
  } catch (err) {
    return { statusCode: 500, body: 'Error: ' + err.message };
  }
};
