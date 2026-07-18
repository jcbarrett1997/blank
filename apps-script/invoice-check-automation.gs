/*
 * MB Storage / JB Storage - Invoice Check sheet automation.
 *
 * Two jobs:
 *  1. doPost: receives "these invoices were just paid in QuickBooks" from
 *     the website's hourly sync and marks the matching rows PAID in the
 *     current month's tab (Brighouse / Batley / Liversedge sections).
 *  2. maybeCreateNextMonthTab (daily trigger): 5 days before the end of
 *     the month, creates next month's tab - customers carried over, Paid
 *     Status cleared, EXCEPT prepaid customers (Time Remaining "Ends ..."
 *     dates in the future) who are pre-marked PAID and never chased.
 *
 * Helper tabs it creates automatically:
 *  - MAPPING: fix name mismatches once ("QuickBooks Name" -> "Sheet Name")
 *    and that customer matches forever after.
 *  - UNMATCHED LOG: payments it couldn't match (also emailed to you once).
 *
 * SET THE SECRET below, then: Deploy > New deployment > Web app,
 * execute as Me, access: Anyone. Copy the web app URL into Netlify as
 * INVOICE_SHEET_WEBAPP_URL, and the same secret as INVOICE_SHEET_SECRET.
 * Then run installTriggers once.
 */

var SECRET = 'CHANGE_ME_TO_MATCH_NETLIFY';
var NOTIFY_EMAIL = 'info@mbstorage.co.uk';
// Traffic lights: green = paid, red = not yet paid, amber = empty unit
var COLOR_PAID = '#57bb8a';
var COLOR_UNPAID = '#e06666';
var COLOR_EMPTY = '#f6b26b';
var SITES = ['BRIGHOUSE', 'BATLEY', 'LIVERSEDGE'];
// Fallback section start columns (0-based) if the header row can't be read
var DEFAULT_SECTION_COLS = { BRIGHOUSE: 0, BATLEY: 7, LIVERSEDGE: 15 };
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
var MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function currentTabName_(d) {
  d = d || new Date();
  return MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
}

function norm_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Sheet names like "Tahir Sultan 2" match QuickBooks "Tahir Sultan" */
function baseName_(s) {
  return norm_(s).replace(/ \d+$/, '').trim();
}

/* Locate the three site sections: header row + start column of each. */
function findSections_(sheet) {
  var rows = Math.min(4, sheet.getLastRow());
  var data = sheet.getRange(1, 1, rows, sheet.getLastColumn()).getValues();
  for (var r = 0; r < data.length; r++) {
    var cols = {};
    for (var c = 0; c < data[r].length; c++) {
      var v = String(data[r][c]).trim().toUpperCase();
      if (SITES.indexOf(v) !== -1) cols[v] = c;
    }
    if (Object.keys(cols).length >= 2) {
      // Fill any missing site (e.g. an overtyped header) from defaults
      SITES.forEach(function (s) { if (!(s in cols)) cols[s] = DEFAULT_SECTION_COLS[s]; });
      return { headerRow: r, subRow: r + 1, cols: cols };
    }
  }
  return { headerRow: 2, subRow: 3, cols: DEFAULT_SECTION_COLS }; // 0-based fallback
}

/* Within one section, find column offsets from the subheader row. */
function sectionColumns_(sheet, sec, site) {
  var startCol = sec.cols[site];
  var nextCols = SITES.map(function (s) { return sec.cols[s]; })
    .filter(function (c) { return c > startCol; });
  var endCol = nextCols.length ? Math.min.apply(null, nextCols) - 1 : sheet.getLastColumn() - 1;
  var width = endCol - startCol + 1;
  var sub = sheet.getRange(sec.subRow + 1, startCol + 1, 1, width).getValues()[0];
  var offsets = { name: 0 };
  for (var i = 0; i < sub.length; i++) {
    var h = norm_(sub[i]);
    if (h === 'name') offsets.name = i;
    if (h === 'paid status' || h === 'paid') offsets.paid = i;
    if (h === 'time remaining') offsets.time = i;
    if (h === 'tick off') offsets.tick = i;
    if (h === 'amount due') offsets.amount = i;
    if (h === 'unit') offsets.unit = i;
  }
  if (offsets.paid === undefined) offsets.paid = 3; // sensible default
  return { startCol: startCol, width: width, offsets: offsets };
}

function getMapping_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('MAPPING');
  if (!sh) {
    sh = ss.insertSheet('MAPPING');
    sh.getRange(1, 1, 1, 2).setValues([['QuickBooks Name', 'Sheet Name']]).setFontWeight('bold');
    return {};
  }
  var map = {};
  sh.getDataRange().getValues().slice(1).forEach(function (row) {
    if (row[0] && row[1]) map[norm_(row[0])] = norm_(row[1]);
  });
  return map;
}

function unmatchedLog_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('UNMATCHED LOG');
  if (!sh) {
    sh = ss.insertSheet('UNMATCHED LOG');
    sh.getRange(1, 1, 1, 5).setValues([['Date', 'Site', 'QuickBooks Name', 'Invoice', 'Amount']]).setFontWeight('bold');
  }
  return sh;
}

function alreadyLogged_(logSheet, site, qbName, tabName) {
  var data = logSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (norm_(data[i][1]) === norm_(site) && norm_(data[i][2]) === norm_(qbName) &&
        String(data[i][0]).indexOf(tabName) !== -1) return true;
  }
  return false;
}

/* Mark one site's paid list in the given tab. Returns {marked, unmatched}. */
function markPaid_(sheet, site, paidList, mapping) {
  var sec = findSections_(sheet);
  var colInfo = sectionColumns_(sheet, sec, site);
  var firstDataRow = sec.subRow + 2; // 1-based row after subheader
  var lastRow = sheet.getLastRow();
  var numRows = lastRow - firstDataRow + 1;
  if (numRows < 1) return { marked: [], unmatched: paidList };

  var range = sheet.getRange(firstDataRow, colInfo.startCol + 1, numRows, colInfo.width);
  var values = range.getValues();
  var marked = [], unmatched = [];

  paidList.forEach(function (p) {
    var qbNorm = norm_(p.name);
    var target = mapping[qbNorm] || qbNorm;
    var hit = false;
    for (var r = 0; r < values.length; r++) {
      var rowName = values[r][colInfo.offsets.name];
      if (!rowName || norm_(rowName) === 'empty') continue;
      if (norm_(rowName) === target || baseName_(rowName) === target) {
        var cur = String(values[r][colInfo.offsets.paid] || '').trim();
        var cell = sheet.getRange(firstDataRow + r, colInfo.startCol + colInfo.offsets.paid + 1);
        if (!cur) {
          cell.setValue('PAID');
          values[r][colInfo.offsets.paid] = 'PAID';
        }
        cell.setBackground(COLOR_PAID); // red -> green, even if a human typed PAID first
        hit = true;
      }
    }
    (hit ? marked : unmatched).push(p);
  });
  return { marked: marked, unmatched: unmatched };
}

function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.secret !== SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad secret' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var tabName = PropertiesService.getScriptProperties().getProperty('CURRENT_TAB') || currentTabName_();
    var sheet = SpreadsheetApp.getActive().getSheetByName(tabName);
    if (!sheet) throw new Error('Tab not found: ' + tabName);

    var mapping = getMapping_();
    var log = unmatchedLog_();
    var allMarked = [], newUnmatched = [];

    Object.keys(body.paid || {}).forEach(function (siteKey) {
      var site = siteKey.toUpperCase();
      if (SITES.indexOf(site) === -1) return;
      var res = markPaid_(sheet, site, body.paid[siteKey] || [], mapping);
      res.marked.forEach(function (p) { allMarked.push(site + ': ' + p.name); });
      res.unmatched.forEach(function (p) {
        if (!alreadyLogged_(log, site, p.name, tabName)) {
          log.appendRow([tabName + ' / ' + new Date().toISOString().slice(0, 10), site, p.name, p.invoice || '', p.amount || '']);
          newUnmatched.push({ site: site, name: p.name, invoice: p.invoice, amount: p.amount });
        }
      });
    });

    out = { ok: true, tab: tabName, marked: allMarked, newUnmatched: newUnmatched };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---- Monthly tab creation ---- */

/* Parse "Ends ..." dates: "Ends Nov 30 2026", "Ends MAY 31st 2026",
   "Ends 31/08/2026", "Ends July 31st" (no year), "Ends end of FEB 2027". */
function parseEndsDate_(text, ref) {
  var t = String(text || '').toLowerCase();
  if (t.indexOf('end') === -1) return null;
  t = t.replace(/ends?/g, '').replace(/of/g, '').trim();

  var m = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));

  var monthIdx = -1, mi;
  for (mi = 0; mi < 12; mi++) {
    if (t.indexOf(MONTH_PREFIXES[mi]) !== -1) { monthIdx = mi; break; }
  }
  if (monthIdx === -1) return null;

  var yearMatch = t.match(/(\d{4})/);
  var year;
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  } else {
    year = ref.getFullYear();
    if (monthIdx < ref.getMonth()) year += 1;
  }
  // Strip the year first so "2027" can't be mistaken for a day of the month
  var tNoYear = yearMatch ? t.replace(yearMatch[1], '') : t;
  var dayMatch = tNoYear.match(/(\d{1,2})(?:st|nd|rd|th)?/);
  var day = dayMatch && parseInt(dayMatch[1], 10) >= 1 && parseInt(dayMatch[1], 10) <= 31
    ? parseInt(dayMatch[1], 10)
    : new Date(year, monthIdx + 1, 0).getDate(); // no day -> end of that month
  return new Date(year, monthIdx, day);
}

function maybeCreateNextMonthTab() {
  var today = new Date();
  var lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  if (today.getDate() !== lastDay - 5) return;
  createNextMonthTab();
}

function createNextMonthTab() {
  var ss = SpreadsheetApp.getActive();
  var now = new Date();
  var nextStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  var newName = currentTabName_(nextStart);
  if (ss.getSheetByName(newName)) return;

  var curName = PropertiesService.getScriptProperties().getProperty('CURRENT_TAB') || currentTabName_(now);
  var cur = ss.getSheetByName(curName);
  if (!cur) throw new Error('Current tab not found: ' + curName);

  var copy = cur.copyTo(ss).setName(newName);
  ss.setActiveSheet(copy);
  ss.moveActiveSheet(ss.getNumSheets());

  var sec = findSections_(copy);
  var prepaid = [], expired = [], review = [];

  SITES.forEach(function (site) {
    // Re-write clean section header (heals overtyped ones like "nxnc,m p[=]")
    copy.getRange(sec.headerRow + 1, sec.cols[site] + 1).setValue(site);

    var colInfo = sectionColumns_(copy, sec, site);
    var firstDataRow = sec.subRow + 2;
    var numRows = copy.getLastRow() - firstDataRow + 1;
    if (numRows < 1) return;
    var range = copy.getRange(firstDataRow, colInfo.startCol + 1, numRows, colInfo.width);
    var values = range.getValues();

    for (var r = 0; r < values.length; r++) {
      var name = String(values[r][colInfo.offsets.name] || '').trim();
      var unit = colInfo.offsets.unit !== undefined ? String(values[r][colInfo.offsets.unit] || '').trim() : '';
      var time = colInfo.offsets.time !== undefined ? values[r][colInfo.offsets.time] : '';
      var paidCell = copy.getRange(firstDataRow + r, colInfo.startCol + colInfo.offsets.paid + 1);
      if (colInfo.offsets.tick !== undefined) {
        copy.getRange(firstDataRow + r, colInfo.startCol + colInfo.offsets.tick + 1).setValue('');
      }

      if (!name && !unit) continue; // filler row - leave untouched

      // Empty unit: amber across the section row, no paid status
      if (norm_(name) === 'empty' || (!name && unit)) {
        paidCell.setValue('');
        copy.getRange(firstDataRow + r, colInfo.startCol + 1, 1, colInfo.width)
          .setBackground(COLOR_EMPTY);
        continue;
      }

      var ends = parseEndsDate_(time, now);
      if (String(time).toLowerCase().indexOf('end') !== -1 && !ends) {
        // Mentions "Ends" but unreadable - safest to keep PAID and flag for a human
        paidCell.setValue('PAID').setBackground(COLOR_PAID);
        review.push(site + ': ' + name + ' ("' + time + '")');
      } else if (ends && ends >= nextStart) {
        paidCell.setValue('PAID').setBackground(COLOR_PAID);
        prepaid.push(site + ': ' + name + ' (until ' + ends.toDateString() + ')');
      } else if (ends && ends < nextStart) {
        paidCell.setValue('').setBackground(COLOR_UNPAID);
        expired.push(site + ': ' + name + ' (prepaid ended ' + ends.toDateString() + ')');
      } else {
        paidCell.setValue('').setBackground(COLOR_UNPAID);
      }
    }
  });

  PropertiesService.getScriptProperties().setProperty('CURRENT_TAB', newName);
  // Until the new month actually starts, payments still belong to the old tab
  PropertiesService.getScriptProperties().setProperty('CURRENT_TAB', curName);
  PropertiesService.getScriptProperties().setProperty('NEXT_TAB', newName);

  MailApp.sendEmail(NOTIFY_EMAIL, 'Invoice Check: ' + newName + ' tab created',
    'The ' + newName + ' tab has been created automatically.\n\n' +
    'Prepaid customers carried over as PAID (' + prepaid.length + '):\n' + (prepaid.join('\n') || '- none') + '\n\n' +
    'Prepaid periods that have ENDED - these customers are now due to pay again (' + expired.length + '):\n' + (expired.join('\n') || '- none') + '\n\n' +
    (review.length ? 'Time Remaining entries I could not read - left as PAID, please check (' + review.length + '):\n' + review.join('\n') + '\n\n' : '') +
    'Everyone else starts the month unpaid as normal.');
}

/* On the 1st of each month, switch payment-marking over to the new tab. */
function rolloverCurrentTab() {
  if (new Date().getDate() !== 1) return;
  var props = PropertiesService.getScriptProperties();
  var next = props.getProperty('NEXT_TAB');
  if (next) {
    props.setProperty('CURRENT_TAB', next);
    props.deleteProperty('NEXT_TAB');
  } else {
    props.setProperty('CURRENT_TAB', currentTabName_());
  }
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('maybeCreateNextMonthTab').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('rolloverCurrentTab').timeBased().everyDays(1).atHour(0).create();
  PropertiesService.getScriptProperties().setProperty('CURRENT_TAB', currentTabName_());
}
