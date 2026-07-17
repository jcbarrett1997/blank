/*
 * MB Storage - QuickBooks Online API client (shared by the booking webhook
 * and the one-time connect/setup functions).
 *
 * Batley and Liversedge are separate companies, so each has its own
 * QuickBooks Online connection (its own OAuth tokens and company/realm ID),
 * but both use the SAME Intuit developer app (one Client ID/Secret) - see
 * SETUP-QUICKBOOKS.md.
 *
 *   QUICKBOOKS_CLIENT_ID
 *   QUICKBOOKS_CLIENT_SECRET
 *   QUICKBOOKS_REDIRECT_URI     e.g. https://www.mbstorage.co.uk/.netlify/functions/qb-callback
 *   QUICKBOOKS_ENVIRONMENT      "sandbox" while testing, "production" once live
 *   QUICKBOOKS_SETUP_KEY        a password of your choosing that protects the
 *                                connect/list-items setup endpoints
 *
 *   QUICKBOOKS_BATLEY_DEPOSIT_ITEM_ID / QUICKBOOKS_BATLEY_RENT_ITEM_ID
 *   QUICKBOOKS_LIVERSEDGE_DEPOSIT_ITEM_ID / QUICKBOOKS_LIVERSEDGE_RENT_ITEM_ID
 *     the QuickBooks Product/Service item IDs to bill against - find these
 *     with qb-list-items.js after connecting.
 */

var qbStore = require('./qb-store');

var CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID;
var CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
var ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
var API_BASE = ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';
var TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
var AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';

function configured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
}

function authorizeUrl(redirectUri, state) {
  return AUTHORIZE_URL +
    '?client_id=' + encodeURIComponent(CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent('com.intuit.quickbooks.accounting') +
    '&state=' + encodeURIComponent(state);
}

async function exchangeCode(code, redirectUri) {
  var form = new URLSearchParams();
  form.append('grant_type', 'authorization_code');
  form.append('code', code);
  form.append('redirect_uri', redirectUri);
  var r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString()
  });
  var json = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('QuickBooks token exchange failed: ' + r.status + ' ' + JSON.stringify(json));
  return json;
}

async function refreshTokens(refreshToken) {
  var form = new URLSearchParams();
  form.append('grant_type', 'refresh_token');
  form.append('refresh_token', refreshToken);
  var r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString()
  });
  var json = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('QuickBooks token refresh failed: ' + r.status + ' ' + JSON.stringify(json));
  return json;
}

/* Returns a stored token set with a valid (non-expiring-soon) access token,
   refreshing (and re-storing, since the refresh token itself rotates) if
   needed. Throws a clear error if the company has never been connected. */
async function getValidTokens(company) {
  var tok = await qbStore.getTokens(company);
  if (!tok) {
    throw new Error('QuickBooks is not connected for ' + company + ' yet - visit /.netlify/functions/qb-connect?site=' + company + ' to connect it.');
  }
  var expiringSoon = !tok.expiresAt || Date.now() > tok.expiresAt - 3 * 60 * 1000;
  if (!expiringSoon) return tok;

  var fresh = await refreshTokens(tok.refresh_token);
  var updated = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || tok.refresh_token,
    realmId: tok.realmId,
    expiresAt: Date.now() + (fresh.expires_in || 3600) * 1000
  };
  await qbStore.setTokens(company, updated);
  return updated;
}

async function qbRequest(company, method, path, body) {
  var tok = await getValidTokens(company);
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  var url = API_BASE + '/v3/company/' + tok.realmId + '/' + path + sep + 'minorversion=65';
  var r = await fetch(url, {
    method: method,
    headers: {
      Authorization: 'Bearer ' + tok.access_token,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  var json = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('QuickBooks API ' + r.status + ': ' + JSON.stringify(json));
  return json;
}

function qEscape(s) { return String(s).replace(/'/g, "\\'"); }

/* Finds an existing customer by email, or creates one. Handles QuickBooks'
   "Duplicate Name Exists" error by disambiguating with the email address -
   DisplayName must be unique per company, and common names collide. */
async function findOrCreateCustomer(company, d) {
  var email = String(d.email || '').trim();
  if (email) {
    var query = "select * from Customer where PrimaryEmailAddr = '" + qEscape(email) + "'";
    var found = await qbRequest(company, 'GET', 'query?query=' + encodeURIComponent(query));
    var rows = found.QueryResponse && found.QueryResponse.Customer;
    if (rows && rows.length) return rows[0];
  }
  var displayName = (d.name || 'Website customer').trim();
  var payload = { DisplayName: displayName };
  if (email) payload.PrimaryEmailAddr = { Address: email };
  if (d.phone) payload.PrimaryPhone = { FreeFormNumber: String(d.phone) };

  try {
    var created = await qbRequest(company, 'POST', 'customer', payload);
    return created.Customer;
  } catch (err) {
    if (email && String(err.message).indexOf('Duplicate Name Exists') !== -1) {
      payload.DisplayName = displayName + ' (' + email + ')';
      var retried = await qbRequest(company, 'POST', 'customer', payload);
      return retried.Customer;
    }
    throw err;
  }
}

/* Records a completed sale (money already received via Stripe) as a
   QuickBooks Sales Receipt - the correct object for payment already in
   hand, as opposed to an Invoice (which represents money still owed).

   UK QuickBooks companies require a VAT code on every sales line
   ("Business Validation Error: Make sure all your transactions have a
   VAT rate before you save"), so each line carries a TaxCodeRef from:

     QUICKBOOKS_<SITE>_RENT_TAX_CODE_ID     (rent includes 20% VAT, so
                                             typically the "20.0% S" code)
     QUICKBOOKS_<SITE>_DEPOSIT_TAX_CODE_ID  (deposits are typically
                                             outside the scope of VAT -
                                             the "No VAT" code)

   Find each company's code IDs with qb-list-taxcodes.js. Amounts are sent
   as VAT-inclusive (GlobalTaxCalculation: TaxInclusive) since the customer
   already paid the gross figure through Stripe. */
async function recordSalesReceipt(company, opts) {
  var prefix = 'QUICKBOOKS_' + company.toUpperCase();
  var depositItemId = process.env[prefix + '_DEPOSIT_ITEM_ID'];
  var rentItemId = process.env[prefix + '_RENT_ITEM_ID'];
  if (!depositItemId || !rentItemId) {
    throw new Error('QuickBooks item IDs are not configured for ' + company + ' - see SETUP-QUICKBOOKS.md.');
  }
  var depositTaxCodeId = process.env[prefix + '_DEPOSIT_TAX_CODE_ID'];
  var rentTaxCodeId = process.env[prefix + '_RENT_TAX_CODE_ID'];

  var customer = await findOrCreateCustomer(company, opts);

  var lines = [];
  if (opts.depositAmount) {
    var depositDetail = { ItemRef: { value: depositItemId }, Qty: 1, UnitPrice: opts.depositAmount };
    if (depositTaxCodeId) depositDetail.TaxCodeRef = { value: depositTaxCodeId };
    lines.push({
      Amount: opts.depositAmount,
      DetailType: 'SalesItemLineDetail',
      Description: opts.depositLabel || 'Refundable deposit',
      SalesItemLineDetail: depositDetail
    });
  }
  if (opts.rentAmount) {
    var rentDetail = { ItemRef: { value: rentItemId }, Qty: 1, UnitPrice: opts.rentAmount };
    if (rentTaxCodeId) rentDetail.TaxCodeRef = { value: rentTaxCodeId };
    lines.push({
      Amount: opts.rentAmount,
      DetailType: 'SalesItemLineDetail',
      Description: opts.rentLabel || 'First rent payment',
      SalesItemLineDetail: rentDetail
    });
  }
  if (!lines.length) throw new Error('Nothing to record - no deposit or rent amount given.');

  var payload = {
    CustomerRef: { value: customer.Id },
    TxnDate: opts.txnDate,
    PrivateNote: 'Paid online via Stripe (' + (opts.reference || 'no reference') + '). Recorded automatically by the website.',
    Line: lines
  };
  // The amounts the customer paid are gross (VAT already included), so
  // tell QuickBooks to work backwards from them rather than adding VAT on top
  if (depositTaxCodeId || rentTaxCodeId) payload.GlobalTaxCalculation = 'TaxInclusive';
  if (opts.email) payload.BillEmail = { Address: String(opts.email).trim() };

  var created = await qbRequest(company, 'POST', 'salesreceipt', payload);

  // Optionally have QuickBooks email the customer its official receipt
  // (VAT breakdown + company details) - the proper document for
  // VAT-registered customers. Off unless QUICKBOOKS_EMAIL_RECEIPTS=true.
  if (process.env.QUICKBOOKS_EMAIL_RECEIPTS === 'true' && opts.email && created.SalesReceipt && created.SalesReceipt.Id) {
    try {
      await qbRequest(company, 'POST', 'salesreceipt/' + created.SalesReceipt.Id + '/send');
    } catch (err) {
      console.error('QuickBooks receipt email failed (receipt itself was created fine):', err.message);
    }
  }
  return created;
}

module.exports = {
  configured: configured,
  authorizeUrl: authorizeUrl,
  exchangeCode: exchangeCode,
  qbRequest: qbRequest,
  findOrCreateCustomer: findOrCreateCustomer,
  recordSalesReceipt: recordSalesReceipt
};
