/*
 * MB Storage - automated SMS reminders for overdue invoices (scheduled daily).
 *
 * Queries each company's QuickBooks for open invoices whose due date was
 * exactly REMINDER_DAYS_AFTER_DUE days ago (default 5), and texts the
 * customer a single reminder via Twilio. One reminder per invoice, ever -
 * tracked in Netlify Blobs ('payment-reminder-log') so re-runs (manual
 * trigger, retries) never double-text someone.
 *
 * Required Netlify env vars (never commit these):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER     the Twilio number to send from, e.g. +447xxxxxxxxx
 *
 * Optional:
 *   REMINDER_DAYS_AFTER_DUE   default 5
 *
 * Uses the same per-company QuickBooks connections (Batley/Liversedge)
 * already set up for invoicing - see SETUP-QUICKBOOKS.md. See
 * SETUP-TWILIO.md for how to get the Twilio values above.
 */

var qb = require('./lib/quickbooks');
var blobs = require('./lib/blobs');

var COMPANIES = [
  { company: 'batley', label: 'Batley' },
  { company: 'liversedge', label: 'Liversedge' }
];
var DAYS_AFTER_DUE = parseInt(process.env.REMINDER_DAYS_AFTER_DUE, 10) || 5;

function todayInLondon() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function daysAgo(dateStr, n) {
  var d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/* UK phone numbers are stored as entered at booking (e.g. "07375 355233")
   - normalise to E.164 for Twilio. Returns null if it doesn't look valid. */
function toE164UK(raw) {
  var digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.indexOf('+') === 0) return /^\+\d{8,15}$/.test(digits) ? digits : null;
  if (digits.indexOf('44') === 0) return /^\d{10,14}$/.test(digits) ? '+' + digits : null;
  if (digits.indexOf('0') === 0) return /^0\d{9,10}$/.test(digits) ? '+44' + digits.slice(1) : null;
  return null;
}

async function sendSms(to, body) {
  var sid = process.env.TWILIO_ACCOUNT_SID;
  var token = process.env.TWILIO_AUTH_TOKEN;
  var from = process.env.TWILIO_FROM_NUMBER;
  var form = new URLSearchParams();
  form.append('To', to);
  form.append('From', from);
  form.append('Body', body);
  var r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  });
  var json = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('Twilio ' + r.status + ': ' + JSON.stringify(json));
  return json;
}

function money(n) { return '£' + Number(n).toFixed(2); }

exports.handler = async function () {
  var sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.log('Twilio not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER) - skipping.');
    return { statusCode: 200, body: 'not configured' };
  }
  if (!qb.configured()) {
    console.log('QuickBooks not configured - skipping.');
    return { statusCode: 200, body: 'not configured' };
  }

  var targetDue = daysAgo(todayInLondon(), DAYS_AFTER_DUE);
  var store = blobs.store('payment-reminder-log');
  var results = [];

  for (var i = 0; i < COMPANIES.length; i++) {
    var cfg = COMPANIES[i];
    try {
      var query = "select * from Invoice where Balance > '0' and DueDate = '" + targetDue + "'";
      var found = await qb.qbRequest(cfg.company, 'GET', 'query?query=' + encodeURIComponent(query));
      var invoices = (found.QueryResponse && found.QueryResponse.Invoice) || [];

      for (var j = 0; j < invoices.length; j++) {
        var inv = invoices[j];
        var logKey = cfg.company + '-' + inv.Id;
        var already = await store.get(logKey);
        if (already) { continue; }

        var customer = null;
        try {
          var cRes = await qb.qbRequest(cfg.company, 'GET', 'customer/' + inv.CustomerRef.value);
          customer = cRes.Customer;
        } catch (e) { console.error('Could not load customer for invoice ' + inv.Id + ':', e.message); }

        var phone = customer && customer.PrimaryPhone && customer.PrimaryPhone.FreeFormNumber;
        var e164 = toE164UK(phone);
        if (!e164) {
          console.log('Skipping invoice ' + inv.Id + ' (' + cfg.label + ') - no usable phone number on the QuickBooks customer record.');
          continue;
        }

        var firstName = ((customer && customer.DisplayName) || 'there').split(' ')[0];
        var body = 'Hi ' + firstName + ', this is a reminder from MB Storage that your invoice ' +
          (inv.DocNumber ? '#' + inv.DocNumber + ' ' : '') + 'for ' + money(inv.Balance) +
          ' (due ' + targetDue + ') is now overdue. Please arrange payment when you can - ' +
          'call 07375 355233 if you have any questions. Thank you.';

        try {
          await sendSms(e164, body);
          await store.setJSON(logKey, { sentAt: new Date().toISOString(), to: e164 });
          results.push(cfg.label + ' invoice ' + inv.Id + ': reminder sent to ' + e164);
        } catch (err) {
          console.error('SMS failed for ' + cfg.label + ' invoice ' + inv.Id + ':', err.message);
          results.push(cfg.label + ' invoice ' + inv.Id + ': FAILED - ' + err.message);
        }
      }
    } catch (err) {
      console.error(cfg.label + ' reminder run failed:', err.message);
      results.push(cfg.label + ': ERROR - ' + err.message);
    }
  }

  console.log('Payment reminders (' + targetDue + ', ' + DAYS_AFTER_DUE + ' days overdue):', results.length ? results.join(' | ') : 'nothing due');
  return { statusCode: 200, body: JSON.stringify({ ok: true, targetDue: targetDue, results: results }) };
};
