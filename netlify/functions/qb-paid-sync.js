/*
 * MB Storage - hourly QuickBooks -> Invoice Check sheet sync.
 *
 * Runs on a schedule (see netlify.toml). For each connected company
 * (Batley, Liversedge, Brighouse/JB), asks QuickBooks for invoices that
 * became fully paid recently, then posts the payer names to the Invoice
 * Check sheet's Apps Script web app, which marks the matching rows PAID
 * in the current month's tab. Anything the sheet can't match by name is
 * emailed to MB Storage once, with instructions to add a MAPPING row.
 *
 *   INVOICE_SHEET_WEBAPP_URL   the Apps Script web app URL (ends /exec)
 *   INVOICE_SHEET_SECRET       must match SECRET in the Apps Script
 *
 * Idempotent by design: a 3-day lookback re-sends recent payments each
 * run; already-PAID rows are left alone and already-reported unmatched
 * names aren't re-emailed (the sheet keeps an UNMATCHED LOG).
 */

var qb = require('./lib/quickbooks');

var COMPANIES = ['batley', 'liversedge', 'brighouse'];
var FROM = process.env.MAIL_FROM || 'MB Storage <quotes@mbstorage.co.uk>';
var TO   = process.env.MAIL_TO   || 'info@mbstorage.co.uk';

function makeSender() {
  if (process.env.RESEND_API_KEY) {
    return async function (msg) {
      var r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()));
      return r.json();
    };
  }
  return async function (msg) {
    var base = process.env.MAILGUN_API_BASE || 'https://api.mailgun.net';
    var form = new URLSearchParams();
    form.append('from', msg.from);
    form.append('to', Array.isArray(msg.to) ? msg.to.join(',') : msg.to);
    form.append('subject', msg.subject);
    if (msg.html) form.append('html', msg.html);
    if (msg.text) form.append('text', msg.text);
    var r = await fetch(base + '/v3/' + process.env.MAILGUN_DOMAIN + '/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('api:' + process.env.MAILGUN_API_KEY).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    if (!r.ok) throw new Error('Mailgun ' + r.status + ': ' + (await r.text()));
    return r.json();
  };
}

exports.handler = async function () {
  var url = process.env.INVOICE_SHEET_WEBAPP_URL;
  var secret = process.env.INVOICE_SHEET_SECRET;
  if (!url || !secret || !qb.configured()) {
    console.log('qb-paid-sync: not configured yet - skipping');
    return { statusCode: 200, body: 'not configured' };
  }

  var since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  var paid = {};

  for (var i = 0; i < COMPANIES.length; i++) {
    var company = COMPANIES[i];
    try {
      var query = "select Id, DocNumber, TotalAmt, CustomerRef from Invoice " +
        "where Balance = '0' and MetaData.LastUpdatedTime >= '" + since + "'";
      var res = await qb.qbRequest(company, 'GET', 'query?query=' + encodeURIComponent(query));
      var invoices = (res.QueryResponse && res.QueryResponse.Invoice) || [];
      if (invoices.length) {
        paid[company] = invoices.map(function (inv) {
          return {
            name: inv.CustomerRef && inv.CustomerRef.name,
            invoice: inv.DocNumber || inv.Id,
            amount: inv.TotalAmt
          };
        }).filter(function (p) { return p.name; });
      }
    } catch (err) {
      // e.g. company not connected yet - fine, skip it
      console.log('qb-paid-sync: skipping ' + company + ' - ' + err.message);
    }
  }

  if (!Object.keys(paid).length) return { statusCode: 200, body: 'nothing new' };

  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: secret, paid: paid }),
    redirect: 'follow'
  });
  var result = await r.json().catch(function () { return {}; });
  console.log('qb-paid-sync result:', JSON.stringify(result));

  if (result.newUnmatched && result.newUnmatched.length) {
    var lines = result.newUnmatched.map(function (u) {
      return u.site + ': "' + u.name + '" (invoice ' + (u.invoice || '?') + ', £' + (u.amount || '?') + ')';
    });
    try {
      await makeSender()({
        from: FROM, to: [TO],
        subject: 'Invoice sheet: ' + result.newUnmatched.length + ' paid customer(s) need matching',
        text: 'These QuickBooks payments could not be matched to a row in the Invoice Check sheet (' + (result.tab || 'current tab') + '):\n\n' +
          lines.join('\n') + '\n\n' +
          'To fix each one permanently: open the Invoice Check sheet\'s MAPPING tab and add a row with the QuickBooks name in column A and the exact sheet name in column B. It will match automatically from then on.\n\n' +
          'They are also listed in the sheet\'s UNMATCHED LOG tab. You won\'t be emailed about these particular payments again.'
      });
    } catch (err) { console.error('Unmatched email failed:', err); }
  }

  return { statusCode: 200, body: 'ok' };
};
