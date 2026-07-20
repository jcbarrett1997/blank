/*
 * MB Storage - website availability from the Site Overview sheet.
 *
 * Counts VACANT (red) container numbers on the BATLEY and LIVERSEDGE tabs
 * and writes the totals to a "WEB AVAILABILITY" tab, which is published as
 * CSV for the website to read. Runs automatically on every change to the
 * spreadsheet (including colour changes) and hourly as a backup.
 *
 * Rules:
 *  - Only cells containing just a number are treated as containers.
 *  - A container is "vacant" when its background colour matches the colour
 *    of the VACANT legend cell on that tab (falls back to pure red).
 *  - At Batley, 3-digit numbers starting with 8 (801, 812...) are the 8ft
 *    containers; everything else counts as 20ft.
 *  - Numbers sitting directly next to the OCCUPIED / VACANT / GIVEN NOTICE
 *    legend labels are ignored.
 *
 * Sites without an occupied/vacant grid on this spreadsheet (e.g. Brighouse,
 * which belongs to the separate JB Storage Solutions site/spreadsheet setup)
 * are maintained by hand directly in the WEB AVAILABILITY tab. Because this
 * script clears and rebuilds that whole tab on every edit, any manually
 * typed row used to get wiped out the instant the trigger fired - it now
 * reads existing rows before clearing and carries forward any site that
 * isn't one of the automated ones below, so manual rows survive.
 */

var SITE_TABS = [
  { tab: 'BATLEY', site: 'Batley' },
  { tab: 'LIVERSEDGE', site: 'Liversedge' }
];
var OUT_TAB = 'WEB AVAILABILITY';
var LEGEND_WORDS = ['OCCUPIED', 'VACANT', 'GIVEN NOTICE'];

function updateAvailability() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var counts = {};

  SITE_TABS.forEach(function (cfg) {
    var sh = ss.getSheetByName(cfg.tab);
    if (!sh) return;
    var range = sh.getDataRange();
    var values = range.getValues();
    var bgs = range.getBackgrounds();

    // Sample the VACANT legend cell's colour so we match your exact red
    var vacantColor = '#ff0000';
    outer:
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        if (String(values[r][c]).trim().toUpperCase() === 'VACANT') {
          if (bgs[r][c] && bgs[r][c].toLowerCase() !== '#ffffff') vacantColor = bgs[r][c];
          break outer;
        }
      }
    }
    vacantColor = vacantColor.toLowerCase();

    // Cells adjacent to legend labels are ignored (they're counters, not containers)
    var skip = {};
    for (var r2 = 0; r2 < values.length; r2++) {
      for (var c2 = 0; c2 < values[r2].length; c2++) {
        var t = String(values[r2][c2]).trim().toUpperCase();
        if (LEGEND_WORDS.indexOf(t) !== -1) {
          skip[r2 + ',' + (c2 + 1)] = true;
          skip[r2 + ',' + (c2 - 1)] = true;
        }
      }
    }

    var n20 = 0, n8 = 0;
    for (var r3 = 0; r3 < values.length; r3++) {
      for (var c3 = 0; c3 < values[r3].length; c3++) {
        if (skip[r3 + ',' + c3]) continue;
        var v = String(values[r3][c3]).trim();
        if (!/^\d+$/.test(v)) continue;
        if ((bgs[r3][c3] || '').toLowerCase() !== vacantColor) continue;
        if (/^8\d\d$/.test(v)) { n8++; } else { n20++; }
      }
    }
    counts[cfg.site] = { '20ft': n20, '8ft': n8 };
  });

  var out = ss.getSheetByName(OUT_TAB) || ss.insertSheet(OUT_TAB);

  // Carry forward any manually-maintained rows (site not in SITE_TABS, e.g.
  // Brighouse) so they survive this automatic rebuild instead of being
  // cleared along with everything else.
  var automatedSites = SITE_TABS.map(function (cfg) { return cfg.site; });
  var manualRows = [];
  var existing = out.getDataRange().getValues();
  for (var i = 1; i < existing.length; i++) {
    var site = existing[i][0];
    if (site && automatedSites.indexOf(site) === -1) manualRows.push(existing[i]);
  }

  out.clearContents();
  var rows = [
    ['site', 'size', 'units_free'],
    ['Batley', '20ft', (counts['Batley'] || {})['20ft'] || 0],
    ['Batley', '8ft', (counts['Batley'] || {})['8ft'] || 0],
    ['Liversedge', '20ft', (counts['Liversedge'] || {})['20ft'] || 0]
  ].concat(manualRows);
  out.getRange(1, 1, rows.length, 3).setValues(rows);
}

/* Wire up automatic runs: on any change to the sheet + hourly backup.
   Run this ONCE from the Apps Script editor. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('updateAvailability').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('updateAvailability').timeBased().everyHours(1).create();
  updateAvailability();
}
