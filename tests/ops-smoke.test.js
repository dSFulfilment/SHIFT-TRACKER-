#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var passed = 0;
var failed = 0;

function check(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

console.log('\nOps smoke — UI presence');
check(html.indexOf('id="floorFindInput"') !== -1, 'Floor Find person input exists');
check(html.indexOf('id="floorAttGlance"') !== -1, 'Today attendance glance exists');
check(html.indexOf('id="floorAttOn"') !== -1 && html.indexOf('id="floorAttLate"') !== -1 && html.indexOf('id="floorAttOut"') !== -1,
  'On / Late / Out chips exist');
check(html.indexOf('id="bpPrintBtn"') !== -1, 'Breaks Print button exists');
check(html.indexOf('id="printBtn"') !== -1, 'Floor Print button exists');
check(html.indexOf('html[data-active-tab="breaks"] #breakPlannerTab') !== -1, 'Breaks print stylesheet exists');
check(html.indexOf('html[data-active-tab="floor"] #canvas') !== -1, 'Floor print stylesheet exists');

console.log('\nOps smoke — storage unification');
check(html.indexOf("PREFIX = 'shift-tracker:'") !== -1, 'Storage polyfill uses shift-tracker: prefix');
check(html.indexOf("LOCAL_KEY_PREFIX = 'shift-tracker:'") !== -1, 'Floor offline path uses same prefix');
check(html.indexOf("LEGACY_PREFIXES = ['shift-floor-planner:', 'shiftFloorPlanner:']") !== -1
  || html.indexOf('shift-floor-planner:') !== -1, 'Legacy prefix migration retained');
check(html.indexOf("KEYS = ['planner', 'breakPlanner', 'packer-shift-data', 'shiftWeekAttendance']") !== -1,
  'Settings keys cover Floor/Breaks/Packer/Roster');

console.log('\nOps smoke — Breaks offline save');
check(html.indexOf('function writeLocalJson') !== -1, 'Local JSON write helper exists');
check(html.indexOf('writeLocalJson(STORAGE_KEY, payload)') !== -1, 'Breaks scheduleOwnSave can write locally');
check(html.indexOf('readLocalJson(STORAGE_KEY)') !== -1, 'Breaks loadAll can read locally');
check(/function scheduleOwnSave[\s\S]*if \(hasSync\(\)\)[\s\S]*writeLocalJson/.test(html),
  'scheduleOwnSave has SharedSync path and local fallback');

console.log('\nOps smoke — dead Packer panels removed');
check(html.indexOf('id="pkCharts"') === -1, 'pkCharts removed');
check(html.indexOf('id="pkQuality"') === -1, 'pkQuality removed');
check(html.indexOf('id="pkFilters"') === -1, 'pkFilters removed');
check(html.indexOf('.top-tabs') === -1, 'orphan .top-tabs CSS removed');
check(html.indexOf('.pk-tab-btn') === -1, 'orphan .pk-tab-btn CSS removed');
check(html.indexOf('function renderCharts') === -1, 'renderCharts removed');
check(html.indexOf('function renderQuality') === -1, 'renderQuality removed');

console.log('\nOps smoke — short names NOT added');
check(html.indexOf('shortName') === -1 && html.indexOf('short-name') === -1 && html.indexOf('firstNameOnly') === -1,
  'No Floor short-names helpers introduced');

console.log('\nOps smoke — tab switch wiring');
check(html.indexOf("data-tab=\"floor\"") !== -1, 'Floor tab button');
check(html.indexOf("data-tab=\"breaks\"") !== -1, 'Breaks tab button');
check(html.indexOf("data-tab=\"settings\"") !== -1, 'Settings tab button');
check(html.indexOf('function showTab') !== -1, 'showTab switcher exists');
check(html.indexOf("__floorAttGlance") !== -1, 'Attendance glance refresh hook');

console.log('\nOps smoke — only SKUs at multiple locations');
check(html.indexOf('clearSkuFromOtherPlates') === -1,
  'SKU assign no longer clears other plates');
check(html.indexOf('function otherSkuPlacementLabels') !== -1,
  'SKU multi-location helper exists');
check(html.indexOf('function findDuplicatePersonAssignments') !== -1,
  'Person duplicate check covers stations + role plates');
check(html.indexOf('Only SKUs can be at multiple locations') !== -1,
  'Duplicate-person warning states SKU exception');

console.log('\nOps smoke — Tracker remaining-time on Floor headcount change');
check(html.indexOf('window.__shiftTrackerRefresh = loadBreakPlannerData') !== -1,
  'Tracker refresh hook is assigned');
check(html.indexOf('countPackers: countLiveStationPackers') !== -1,
  'Floor exposes live station packer count');
check(html.indexOf('function captureHeadcountChange') !== -1,
  'Headcount-change capture exists');
check(html.indexOf('function estimateBoxesLeft') !== -1,
  'From-now boxes-left estimate exists');
check(html.indexOf('remaining finish reworked from now') !== -1,
  'Toast mentions reworked remaining finish');
check(html.indexOf("__shiftTrackerRefresh()") !== -1,
  'Floor clear / remove paths ping Tracker');

console.log('\nOps smoke — Packer shift report (Boxes + Intra + Raw Data + Exec, inlined)');
check(html.indexOf('id="psrRoot"') !== -1, 'Packer shift report root exists');
check(html.indexOf('id="psrBoxes"') !== -1 && html.indexOf('id="psrIntra"') !== -1,
  'Packer has Boxes + Intra file inputs');
check(html.indexOf('id="psrRaw"') !== -1, 'Packer has Raw Data file input');
check(html.indexOf('id="psrExec"') !== -1, 'Packer has Executive Summary file input');
check(html.indexOf('id="psrSummary"') === -1, 'Overall Summary picker removed');
check(html.indexOf('window.PackerShiftReport') !== -1 || html.indexOf('root.PackerShiftReport') !== -1,
  'PackerShiftReport inlined into index.html');
check(html.indexOf('typeof XLSX') !== -1 || html.indexOf('XLSX.read') !== -1,
  'SheetJS XLSX inlined into index.html');
check(html.indexOf('script src="js/xlsx.mini.min.js"') === -1, 'No external xlsx script src');
check(html.indexOf('script src="js/packer-shift-report.js"') === -1, 'No external packer-shift-report script src');
check(html.indexOf('Dandenong South') !== -1, 'Facility name shown in Packer UI');
check(html.indexOf('function overallStrikeFromBlend') !== -1, 'Legacy blended strike helper still present in analytics');
check(html.indexOf('data-psr-view="byhour"') !== -1, 'By hour Packer view exists');
check(html.indexOf('Boxes each hour vs target') !== -1 || html.indexOf('Intra hour vs target') !== -1,
  'Intra hour vs SKU target UI present');
check(html.indexOf('enrichHourLinesWithSkuTargets') !== -1 || html.indexOf('scoreHourVsSku') !== -1,
  'Hour-vs-SKU scoring inlined');
check(html.indexOf('SKU mix') !== -1 || html.indexOf('>Sizes<') !== -1 || html.indexOf('Sizes (Boxes)') !== -1,
  'Sizes column / detail present');
check(html.indexOf('Total / avg') !== -1, 'SKU performance total/avg row present');
check(html.indexOf('id="psrExportBtn"') !== -1, 'Export report button exists');
check(html.indexOf('buildExportWorkbook') !== -1, 'Export workbook builder inlined');
check(html.indexOf('data-psr-view="mixed"') === -1, 'Separate Mixed SKUs Packer tab removed');
check(html.indexOf('class="psr-mixed"') === -1 && html.indexOf("psr-mixed\">Mixed") === -1,
  'No Mixed badge chips in Packer UI');
check(html.indexOf('Box Sku Sizes') !== -1, 'Raw Data Box Sku Sizes referenced');
check(html.indexOf('parseBoxSkuSizes') !== -1, 'parseBoxSkuSizes inlined');
check(html.indexOf('By SKU') !== -1 && html.indexOf('renderCombinedBySku') !== -1,
  'Combined By SKU (Boxes + Raw Data) detail present');
check(html.indexOf('Raw idle') !== -1 && html.indexOf('Raw BPH') !== -1,
  'By SKU shows Raw idle / Raw BPH columns');
check(html.indexOf('loadExecutiveSummaryRows') !== -1, 'Executive Summary loader inlined');
check(html.indexOf('Shift h') !== -1 && html.indexOf('Shift (Hours)') !== -1,
  'Shift h column / Raw Shift (Hours) documented');
check(html.indexOf('buildReportFromFiles(boxesFile, intraFile, rawFile, execFile)') !== -1 ||
  html.indexOf('buildReportFromFiles(boxesIn.files[0], intraIn.files[0], rawFile, execFile)') !== -1,
  'Packer builds from Boxes + Intra + optional Raw + Exec');
check(html.indexOf('sizesCell') !== -1 || html.indexOf('function sizesCell') !== -1,
  'Combined sizes cell (Boxes + Raw Data) present');

console.log('\nOps smoke — day-linked breaks (BPH ignores breaks)');
check(html.indexOf('window.__opsDayLink') !== -1, 'Shared ops day link exists');
check(html.indexOf('id="bpDays"') !== -1 && html.indexOf('function renderDayChrome') !== -1, 'Breaks day chips exist');
check(html.indexOf('getGroupsFor') !== -1, 'Breaks exposes day-keyed groups');
check(html.indexOf('function buildBreakLookup') === -1, 'Packer BPH does not use break lookup');

console.log('\nOps smoke — Breaks simplified (time + people, free popup)');
check(html.indexOf('id="bpFreeNav"') !== -1 && html.indexOf('id="bpFreeOpen"') !== -1, 'Not-on-break free nav exists');
check(html.indexOf('id="bpFreePrev"') !== -1 && html.indexOf('id="bpFreeNext"') !== -1, 'Free-person arrow buttons exist');
check(html.indexOf('function openFreePoolSheet') !== -1 && html.indexOf('function cycleFreePerson') !== -1,
  'Free pool popup + arrow cycle helpers exist');
check(html.indexOf('bp-col-st') === -1 && html.indexOf('bp-group-stations') === -1,
  'Stations column removed from Breaks table UI');
check(html.indexOf('id="bpPool"') !== -1 && /id="bpPool"[^>]*\bhidden\b/.test(html),
  'Always-visible free pool is hidden');

console.log('\nOps smoke — backup round-trip helpers');
check(html.indexOf('shift-floor-planner-backup') !== -1, 'Whole-app backup type present');
check(html.indexOf('exportBackup') !== -1, 'exportBackup present');
check(html.indexOf('importAny') !== -1, 'importAny restore present');

// Lightweight in-memory storage round-trip (mirrors Settings KEYS path)
console.log('\nOps smoke — storage round-trip (in-memory)');
(function () {
  var store = {};
  var PREFIX = 'shift-tracker:';
  var LEGACY = ['shift-floor-planner:', 'shiftFloorPlanner:'];
  function get(key) {
    if (Object.prototype.hasOwnProperty.call(store, PREFIX + key)) return store[PREFIX + key];
    for (var i = 0; i < LEGACY.length; i++) {
      if (Object.prototype.hasOwnProperty.call(store, LEGACY[i] + key)) {
        store[PREFIX + key] = store[LEGACY[i] + key];
        return store[PREFIX + key];
      }
    }
    return null;
  }
  function set(key, value) { store[PREFIX + key] = value; }
  // migrate legacy
  store['shiftFloorPlanner:planner'] = JSON.stringify({ currentShift: 'morning', shiftData: {} });
  var migrated = get('planner');
  check(!!migrated && migrated.indexOf('morning') !== -1, 'migrates legacy Floor key');
  set('breakPlanner', JSON.stringify({ morning: { groups: [{ id: 'g1' }] }, afternoon: { groups: [] } }));
  var bp = JSON.parse(get('breakPlanner'));
  check(bp.morning.groups[0].id === 'g1', 'Breaks payload round-trips');
  var keys = ['planner', 'breakPlanner', 'packer-shift-data', 'shiftWeekAttendance'];
  var backup = { type: 'shift-floor-planner-backup', keys: {} };
  keys.forEach(function (k) { backup.keys[k] = get(k); });
  check(backup.keys.breakPlanner != null, 'backup includes breakPlanner');
  // restore
  store = {};
  keys.forEach(function (k) {
    if (backup.keys[k] != null) set(k, backup.keys[k]);
  });
  check(JSON.parse(get('breakPlanner')).morning.groups[0].id === 'g1', 'restore round-trip keeps groups');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
