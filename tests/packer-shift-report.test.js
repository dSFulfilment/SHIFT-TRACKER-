#!/usr/bin/env node
'use strict';

var PSR = require('../js/packer-shift-report.js');
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

console.log('\nPacker shift report JS — core scoring');
var boxes = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Alice Smith', 'Station Name': 'A1', 'Primary Sku': 250, 'Boxes Packed': 80, 'Packing Time Seconds': 14400 },
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Alice Smith', 'Station Name': 'A1', 'Primary Sku': 500, 'Boxes Packed': 50, 'Packing Time Seconds': 7200 },
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Bob Jones', 'Station Name': 'B2', 'Primary Sku': 250, 'Boxes Packed': 40, 'Packing Time Seconds': 10800 },
  { 'Report Date': '2026-08-13', Shift: 'afternoon_shift', 'Pnp Worker Name': 'Alice Smith', 'Station Name': 'A1', 'Primary Sku': 250, 'Boxes Packed': 60, 'Packing Time Seconds': 10800 },
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Eve Short', 'Station Name': 'E5', 'Primary Sku': 250, 'Boxes Packed': 2, 'Packing Time Seconds': 600 }
];
var intra = [
  { 'Report Date Hour': '2026-08-13 08:00', 'Pnp Worker Name': 'Alice Smith', 'Boxes Packed': 30 },
  { 'Report Date Hour': '2026-08-13 09:00', 'Pnp Worker Name': 'Alice Smith', 'Boxes Packed': 40 },
  { 'Report Date Hour': '2026-08-13 14:00', 'Pnp Worker Name': 'Alice Smith', 'Boxes Packed': 20 },
  { 'Report Date Hour': '2026-08-13 15:00', 'Pnp Worker Name': 'Alice Smith', 'Boxes Packed': 25 }
];
var report = PSR.buildReport(boxes, 0, intra);
var morning = {};
report.morning.forEach(function (r) { morning[r.workerDisplay] = r; });
check(morning['Alice Smith'] && morning['Alice Smith'].flag === 'On/above target', 'Alice morning on/above');
check(Math.abs(morning['Alice Smith'].pctOfTarget - (130 / 110 * 100)) < 0.01, 'Alice % of target');
check(morning['Bob Jones'] && morning['Bob Jones'].flag === 'Below strike', 'Bob below strike (red)');
check(morning['Bob Jones'].why && morning['Bob Jones'].why.indexOf('short by') !== -1, 'Bob why explains shortfall');
check(morning['Bob Jones'].skuLines && morning['Bob Jones'].skuLines.length >= 1, 'Bob has SKU breakdown');
check(report.morningTotals && report.morningTotals.packers === 3, 'Morning shift totals packers');
check(morning['Eve Short'] && morning['Eve Short'].flag === 'Below strike', 'Eve below strike still scored');

// Averages out: one SKU under strike, overall still clears strike + target → green
var dipBoxes = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Pat Dip', 'Station Name': 'A1', 'Primary Sku': 250, 'Boxes Packed': 14, 'Packing Time Seconds': 3600 },
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Pat Dip', 'Station Name': 'A1', 'Primary Sku': 500, 'Boxes Packed': 50, 'Packing Time Seconds': 3600 }
];
var dipReport = PSR.buildReport(dipBoxes, 0, []);
check(dipReport.morning[0].flag === 'On/above target', 'Pat Dip averages out above strike → on/above');
check(dipReport.morning[0].skuLines.some(function (L) { return L.verdict === 'under strike'; }), 'Pat Dip still has an under-strike SKU line');

// Above strike but below target → yellow
var midBoxes = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Mid Pack', 'Station Name': 'M1', 'Primary Sku': 250, 'Boxes Packed': 45, 'Packing Time Seconds': 10800 }
];
var midReport = PSR.buildReport(midBoxes, 0, []);
check(midReport.morning[0].flag === 'Below target', 'Mid Pack above strike but below target → yellow');
check(report.afternoon.length === 1 && report.afternoon[0].workerDisplay === 'Alice Smith', 'Alice afternoon separate row');
check(report.exclusions.under_15_min == null, 'no under-15-min exclusion');

var aliceHours = morning['Alice Smith'].hourLines || [];
check(aliceHours.length >= 2, 'Alice morning has Intra hour lines');
check(aliceHours.every(function (h) { return h.hour < 14; }), 'Alice morning hours are before 14:00');
check(report.byHour && report.byHour.length >= 1, 'byHour rollup present');
var afternoon = {};
report.afternoon.forEach(function (r) { afternoon[r.workerDisplay] = r; });
check((afternoon['Alice Smith'].hourLines || []).some(function (h) { return h.hour >= 14; }),
  'Alice afternoon has Intra hours from 14:00+');
check(morning['Alice Smith'].skuMix && morning['Alice Smith'].skuMix.isMixed === true, 'Alice morning is mixed SKUs');
check(morning['Alice Smith'].skuMix.parts.length === 2, 'Alice morning mix has 2 SKUs');
check(morning['Bob Jones'].skuMix && morning['Bob Jones'].skuMix.isMixed === false, 'Bob morning is single SKU');

var wb = PSR.buildExportWorkbook(report);
check(wb && wb.SheetNames && wb.SheetNames.indexOf('Morning shift') !== -1, 'Export has Morning shift sheet');
check(wb.SheetNames.indexOf('SKU detail') !== -1, 'Export has SKU detail sheet');
check(wb.SheetNames.indexOf('Boxes raw lines') !== -1 || wb.SheetNames.indexOf('Raw data') !== -1,
  'Export has Boxes raw lines sheet');
check(wb.SheetNames.indexOf('Mixed SKUs') !== -1 || wb.SheetNames.indexOf('Sizes (Raw Data)') !== -1,
  'Export has sizes / Mixed sheet');
check(wb.SheetNames.indexOf('Raw Data export') !== -1 || wb.SheetNames.indexOf('Raw data') !== -1,
  'Export has Raw Data export sheet');
check(wb.SheetNames.indexOf('By hour') !== -1, 'Export has By hour sheet');
check(morning['Alice Smith'].rawLines && morning['Alice Smith'].rawLines.length === 2, 'Alice raw lines attached');
var buf = PSR.workbookToArrayBuffer(wb);
check(buf && buf.byteLength > 1000, 'Export workbook writes bytes');

console.log('\nPacker shift report JS — Raw Data Box Sku Sizes');
var mixParsed = PSR.parseBoxSkuSizes('250g, 600g');
check(mixParsed.isMixed === true && mixParsed.skus.indexOf(250) !== -1 && mixParsed.skus.indexOf(600) !== -1,
  'parseBoxSkuSizes detects multi-size 250+600');
check(PSR.parseBoxSkuSizes('700g').isMixed === false, 'single 700g is not multi-size');
var fs = require('fs');
var path = require('path');
var rawCsv = fs.readFileSync(path.join(__dirname, '../fixtures/packer-shift/Raw_Data.csv'), 'utf8');
var sheetRows = PSR.csvTextToSheetRows(rawCsv, 'Raw_Data.csv', PSR.RAW_DATA_COLS);
var loaded = PSR.loadRawDataRows(sheetRows);
check(loaded.rows.length > 10, 'Raw Data fixture loads rows');
var mixedSegs = loaded.rows.filter(function (r) { return r.isMixed; });
check(mixedSegs.length >= 1, 'Raw Data fixture has multi-size Box Sku Sizes');
var reportRaw = PSR.buildReport(boxes, 0, intra, loaded.rows);
check(reportRaw.rawDataMixed && reportRaw.rawDataMixed.length >= 1, 'buildReport attaches rawDataMixed');
check((reportRaw.rawDataMixed[0].segments || []).length >= 1, 'multi-size worker has segments');
var wb2 = PSR.buildExportWorkbook(reportRaw);
check(wb2.SheetNames.indexOf('Sizes (Raw Data)') !== -1 || wb2.SheetNames.indexOf('Mixed SKUs') !== -1,
  'export with Raw Data has sizes sheet');
check(wb2.SheetNames.indexOf('Raw Data export') !== -1, 'export with Raw Data has Raw Data export sheet');

console.log('\nPacker shift report JS — Shift hours (Dandenong South)');
var execCsv = fs.readFileSync(path.join(__dirname, '../fixtures/packer-shift/Executive_Summary.csv'), 'utf8');
var execSheet = PSR.csvTextToSheetRows(execCsv, 'Executive_Summary.csv', PSR.EXEC_SUMMARY_COLS);
var execLoaded = PSR.loadExecutiveSummaryRows(execSheet);
check(execLoaded.rows.length >= 5, 'Executive Summary fixture loads workers');
check(execLoaded.facilityFiltered === false, 'Exec Summary without Facility Name treated as DS-only');
var hanaExec = execLoaded.rows.find(function (r) {
  return String(r.workerDisplay).toLowerCase().indexOf('hana') !== -1;
});
check(hanaExec && hanaExec.shiftHours > 0, 'Exec Summary has Packing Time / direct hours');

var dsOnly = PSR.loadExecutiveSummaryRows([
  { 'Pnp Worker Name': 'Site A', 'Facility Name': 'Other Site', 'Packing Time (Hours)': 9 },
  { 'Pnp Worker Name': 'Site DS', 'Facility Name': 'Dandenong South', 'Packing Time (Hours)': 7.5 }
]);
check(dsOnly.facilityFiltered === true, 'Exec Summary with Facility Name enables filter');
check(dsOnly.rows.length === 1 && dsOnly.rows[0].workerDisplay === 'Site DS',
  'Exec Summary keeps Dandenong South only');
check(dsOnly.droppedFacility === 1, 'Exec Summary drops other facilities');

var aliceBoxes = [
  {
    'Report Date': '2026-08-13',
    Shift: 'morning_shift',
    'Pnp Worker Name': 'Alice Smith',
    'Station Name': 'A1',
    'Primary Sku': 250,
    'Boxes Packed': 80,
    'Packing Time Seconds': 14400
  }
];
var rawShift = [{
  reportDate: '2026-08-13',
  facilityName: 'Dandenong South',
  workerDisplay: 'Alice Smith',
  workerKey: 'Alice Smith',
  shiftHours: 7.25,
  hours: 4,
  boxes: 80,
  skus: [250],
  isMixed: false,
  boxSkuSizes: '250g',
  idlePct: 0.1,
  actualBph: 20,
  shiftKey: 'morning_shift',
  shiftLabel: 'Morning'
}];
var execAlice = [{
  workerDisplay: 'Alice Smith',
  workerKey: 'Alice Smith',
  shiftHours: 6.5,
  packingHours: 6.5
}];
var fromRaw = PSR.buildReport(aliceBoxes, 0, [], rawShift, execAlice);
check(fromRaw.morning[0].shiftHours === 7.25, 'Shift h prefers Raw Data Shift (Hours)');
check(fromRaw.morning[0].shiftHoursSource === 'raw_data', 'shiftHoursSource is raw_data');
check(Math.abs(fromRaw.morning[0].hours - 4) < 0.01, 'Pack h still from Boxes packing time');

var fromExec = PSR.buildReport(aliceBoxes, 0, [], [], execAlice);
check(fromExec.morning[0].shiftHours === 6.5, 'Shift h falls back to Executive Summary');
check(fromExec.morning[0].shiftHoursSource === 'executive_summary', 'shiftHoursSource is executive_summary');

var noShift = PSR.buildReport(aliceBoxes, 0, [], [], []);
check(noShift.morning[0].shiftHours == null, 'Shift h empty without Raw/Exec');

check(loaded.rows.some(function (r) { return r.shiftHours > 0; }),
  'Raw Data fixture carries Shift (Hours) for DS rows');

var wbShift = PSR.buildExportWorkbook(fromRaw);
var morningSheet = wbShift.Sheets['Morning shift'];
var morningText = JSON.stringify(morningSheet);
check(morningText.indexOf('Shift hours') !== -1, 'Export Morning shift sheet has Shift hours column');

console.log('\nPacker shift report JS — Intra hour vs SKU target');
var bobHour = report.morning.filter(function (r) { return r.workerDisplay === 'Bob Jones'; })[0];
// Bob only in boxes fixture Intra? add Intra for Bob
var bobIntra = [
  { 'Report Date Hour': '2026-08-13 08:00', 'Pnp Worker Name': 'Bob Jones', 'Boxes Packed': 12 },
  { 'Report Date Hour': '2026-08-13 09:00', 'Pnp Worker Name': 'Bob Jones', 'Boxes Packed': 16 }
];
var bobBoxes = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Bob Jones', 'Station Name': 'B2', 'Primary Sku': 250, 'Boxes Packed': 40, 'Packing Time Seconds': 10800 }
];
var bobRep = PSR.buildReport(bobBoxes, 0, bobIntra);
check(bobRep.morning[0].hourLines.length === 2, 'Bob has 2 Intra hour lines');
check(bobRep.morning[0].hourLines[0].skuLabel && bobRep.morning[0].hourLines[0].skuLabel.indexOf('250') !== -1,
  'Bob hour SKU from Boxes Primary Sku');
check(bobRep.morning[0].hourLines[0].targetBoxes === 16, 'Bob hour target = 250g target BPH × 1h');
check(bobRep.morning[0].hourLines[0].flag === 'Below strike', 'Bob 12 boxes in hour → below strike');
check(bobRep.morning[0].hourLines[1].flag === 'On/above target', 'Bob 16 boxes in hour → on/above');

var aliceH = morning['Alice Smith'].hourLines;
check(aliceH.length >= 2, 'Alice morning hours present for SKU score');
check(aliceH[0].targetBph != null && aliceH[0].targetBph > 16, 'Alice mixed blend target > single 250');
check(aliceH[0].flag === 'On/above target', 'Alice 30 boxes clears blended hour target');
check(aliceH[0].skuSource === 'boxes_shift', 'Alice hour SKU source is boxes_shift');

var intraSkuRows = [
  { 'Report Date Hour': '2026-08-13 08:00', 'Pnp Worker Name': 'Alice Smith', 'Boxes Packed': 10, 'Primary Sku': 250 },
  { 'Report Date Hour': '2026-08-13 09:00', 'Pnp Worker Name': 'Alice Smith', 'Boxes Packed': 10, 'Primary Sku': 500 }
];
var intraSkuRep = PSR.buildReport(boxes, 0, intraSkuRows);
var aHours = intraSkuRep.morning.filter(function (r) { return r.workerDisplay === 'Alice Smith'; })[0].hourLines;
check(aHours[0].skuSource === 'intra' && aHours[0].targetBoxes === 16, 'Intra Primary Sku 250 drives hour target');
check(aHours[1].skuSource === 'intra' && aHours[1].targetBoxes === 23, 'Intra Primary Sku 500 drives hour target');
check(aHours[0].flag === 'Below strike', '10 boxes on 250g hour → below strike');

var byHourPacker = bobRep.byHour[0].packers.filter(function (p) { return p.workerDisplay === 'Bob Jones'; })[0];
check(byHourPacker && byHourPacker.flag === 'Below strike', 'By hour view carries hour flag');
var wbHour = PSR.buildExportWorkbook(bobRep);
check(JSON.stringify(wbHour.Sheets['By hour']).indexOf('Target boxes (1h)') !== -1,
  'Export By hour has target columns');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
