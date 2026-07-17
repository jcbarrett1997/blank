/*
 * MB Storage - list QuickBooks VAT codes and their IDs, so you can copy
 * the right ones into QUICKBOOKS_<SITE>_RENT_TAX_CODE_ID and
 * QUICKBOOKS_<SITE>_DEPOSIT_TAX_CODE_ID.
 *
 * Visit after connecting a company (qb-connect.js):
 *   /.netlify/functions/qb-list-taxcodes?site=batley&key=YOUR_SETUP_KEY
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
    var result = await qb.qbRequest(site, 'GET', 'query?query=' + encodeURIComponent('select Id, Name, Description from TaxCode'));
    var codes = (result.QueryResponse && result.QueryResponse.TaxCode) || [];
    var lines = codes.map(function (c) {
      return c.Id + '  -  ' + c.Name + (c.Description ? '  (' + c.Description + ')' : '');
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: lines.length
        ? lines.join('\n') +
          '\n\nTypical UK choice (confirm with your bookkeeper):\n' +
          '  QUICKBOOKS_' + site.toUpperCase() + '_RENT_TAX_CODE_ID     = the ID of "20.0% S" (standard rate - the rent includes 20% VAT)\n' +
          '  QUICKBOOKS_' + site.toUpperCase() + '_DEPOSIT_TAX_CODE_ID  = the ID of "No VAT" (deposits are typically outside the scope of VAT)'
        : 'No VAT codes found - check VAT is set up in this QuickBooks company (Taxes menu).'
    };
  } catch (err) {
    return { statusCode: 500, body: 'Error: ' + err.message };
  }
};
