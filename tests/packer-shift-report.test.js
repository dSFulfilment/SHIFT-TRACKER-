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
check(morning['Alice Smith'].hoursBasis === 'intra', 'Alice need uses Intra shift length');
check(morning['Alice Smith'].shiftHours === 2 && morning['Alice Smith'].shiftHoursSource === 'intra',
  'Alice Shift h = Intra clock-hour count');
check(report.morningTotals.intraHours === 2, 'Morning Intra h total = Alice 2 (Bob/Eve have no Intra)');
check(morning['Alice Smith'].intraBoxes === 70, 'Alice Intra boxes = 30+40 from Intra hours');
check(report.morningTotals.intraBoxes === 70, 'Morning Intra boxes total');
check(report.byHour[0].packers.some(function (p) {
  return p.workerDisplay === 'Alice Smith' && p.boxesScore && p.boxesScore.boxesFile === 130;
}), 'By hour carries Boxes file score beside Intra boxes');
check(Math.abs(morning['Alice Smith'].pctOfTarget - (130 / (110 * 2 / 6) * 100)) < 0.01,
  'Alice % of target scales need by Intra hours');
check(morning['Bob Jones'] && morning['Bob Jones'].flag === 'Below strike', 'Bob below strike (red)');
check(morning['Bob Jones'].hoursBasis === 'packing', 'Bob with no Intra falls back to Pack h');
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

// Above strike but below target → orange (Below target flag)
var midBoxes = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Mid Pack', 'Station Name': 'M1', 'Primary Sku': 250, 'Boxes Packed': 45, 'Packing Time Seconds': 10800 }
];
var midReport = PSR.buildReport(midBoxes, 0, []);
check(midReport.morning[0].flag === 'Below target', 'Mid Pack above strike but below target → orange');
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

console.log('\nPacker shift report JS — Shift hours (Intra only; Raw/Exec not used yet)');
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
check(fromRaw.morning[0].shiftHours == null, 'Raw Data Shift (Hours) not used for Shift h yet');
check(fromRaw.morning[0].shiftHoursSource == null, 'no Raw/Exec shiftHoursSource without Intra');
check(Math.abs(fromRaw.morning[0].hours - 4) < 0.01, 'Pack h still from Boxes packing time');

var fromExec = PSR.buildReport(aliceBoxes, 0, [], [], execAlice);
check(fromExec.morning[0].shiftHours == null, 'Executive Summary hours not used for Shift h yet');
check(fromExec.morning[0].shiftHoursSource == null, 'no Exec shiftHoursSource without Intra');

var noShift = PSR.buildReport(aliceBoxes, 0, [], [], []);
check(noShift.morning[0].shiftHours == null, 'Shift h empty without Intra');

check(loaded.rows.some(function (r) { return r.shiftHours > 0; }),
  'Raw Data fixture carries Shift (Hours) for DS rows');

var wbShift = PSR.buildExportWorkbook(fromRaw);
var morningSheet = wbShift.Sheets['Morning shift'];
var morningText = JSON.stringify(morningSheet);
check(morningText.indexOf('Shift hours') !== -1, 'Export Morning shift sheet has Shift hours column');

console.log('\nPacker shift report JS — Intra Hour is boxes-only (no hour target flags)');
var bobIntra = [
  { 'Report Date Hour': '2026-08-13 08:00', 'Pnp Worker Name': 'Bob Jones', 'Boxes Packed': 12 },
  { 'Report Date Hour': '2026-08-13 09:00', 'Pnp Worker Name': 'Bob Jones', 'Boxes Packed': 10 },
  { 'Report Date Hour': '2026-08-13 10:00', 'Pnp Worker Name': 'Bob Jones', 'Boxes Packed': 10 },
  { 'Report Date Hour': '2026-08-13 11:00', 'Pnp Worker Name': 'Bob Jones', 'Boxes Packed': 8 }
];
var bobBoxes = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Bob Jones', 'Station Name': 'B2', 'Primary Sku': 250, 'Boxes Packed': 40, 'Packing Time Seconds': 10800 }
];
var bobRep = PSR.buildReport(bobBoxes, 0, bobIntra);
check(bobRep.morning[0].hourLines.length === 4, 'Bob has 4 Intra hour lines');
check(bobRep.morning[0].hourLines[0].boxes === 12 && bobRep.morning[0].hourLines[1].boxes === 10,
  'Intra hour lines carry boxes only');
check(bobRep.morning[0].hourLines[0].flag == null && bobRep.morning[0].hourLines[0].targetBoxes == null,
  'Intra hours are not scored vs SKU target');
check(bobRep.morning[0].hoursBasis === 'intra' && bobRep.morning[0].shiftHours === 4,
  'Bob Shift h from Intra hour count');
check(bobRep.morning[0].flag === 'Below strike',
  'Boxes + Intra shift length still sets packer flag (4h strike need)');
var wbHour = PSR.buildExportWorkbook(bobRep);
check(JSON.stringify(wbHour.Sheets['By hour']).indexOf('Target boxes (1h)') === -1,
  'Export By hour has no hour-target columns');
check(JSON.stringify(wbHour.Sheets['By hour']).indexOf('Intra boxes this hour') !== -1,
  'Export By hour lists Intra boxes this hour');
check(JSON.stringify(wbHour.Sheets['By hour']).indexOf('Boxes file (shift)') !== -1,
  'Export By hour includes Boxes file columns');

console.log('\nPacker shift report JS — Intra shift length for fair strikes');
var needPack = PSR.needBoxesFromHours(
  [{ hours: 1, targetBph: 16, strikeBph: 14.6 }],
  1,
  0
);
check(needPack.hoursBasis === 'packing' && Math.abs(needPack.strikeBoxes - 14.6) < 0.01,
  'needBoxesFromHours falls back to packing');
var needIntra = PSR.needBoxesFromHours(
  [{ hours: 1, targetBph: 16, strikeBph: 14.6 }],
  1,
  4
);
check(needIntra.hoursBasis === 'intra' && Math.abs(needIntra.strikeBoxes - 58.4) < 0.01,
  'needBoxesFromHours uses Intra × strike');

// 40 boxes in 1 pack hour clears packing strike, but 4 Intra hours → fairer Below strike
var shortPack = [
  { 'Report Date': '2026-08-13', Shift: 'morning_shift', 'Pnp Worker Name': 'Fair Strike', 'Station Name': 'F1', 'Primary Sku': 250, 'Boxes Packed': 40, 'Packing Time Seconds': 3600 }
];
var longIntra = [
  { 'Report Date Hour': '2026-08-13 08:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 10 },
  { 'Report Date Hour': '2026-08-13 09:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 10 },
  { 'Report Date Hour': '2026-08-13 10:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 10 },
  { 'Report Date Hour': '2026-08-13 11:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 10 }
];
var packOnly = PSR.buildReport(shortPack, 0, []);
check(packOnly.morning[0].flag === 'On/above target', 'Without Intra, 40 boxes / 1 pack h clears 250g target');
var withIntra = PSR.buildReport(shortPack, 0, longIntra);
check(withIntra.morning[0].shiftHours === 4 && withIntra.morning[0].hoursBasis === 'intra',
  'With Intra, Shift h = 4 clock hours');
check(withIntra.morning[0].flag === 'Below strike',
  'With Intra, same boxes judged on 4h strike need → below strike');
check(Math.abs(withIntra.morning[0].strikeBoxes - 4 * 14.6) < 0.01, 'Strike need = 4 × 14.6');

console.log('\nPacker shift report JS — auto breaks (15m >4h, +30m >6h)');
check(PSR.autoBreakMinutes(4) === 0, 'exactly 4h → no auto break');
check(PSR.autoBreakMinutes(4.01) === 15, 'just over 4h → 15m');
check(PSR.autoBreakMinutes(5) === 15, '5h → 15m');
check(PSR.autoBreakMinutes(6) === 15, 'exactly 6h → 15m only');
check(PSR.autoBreakMinutes(6.01) === 45, 'just over 6h → 15+30 = 45m');
check(PSR.autoBreakMinutes(8) === 45, '8h → 45m');

// Legacy Breaks-group helpers still work if needed
check(PSR.minutesBetweenHm('09:45', '10:00') === 15, '15m tea range = 15 minutes');
check(PSR.breakMinutesForGroup({
  teaStart: '09:45', teaEnd: '10:00', mealStart: '12:00', mealEnd: '12:30'
}) === 45, 'tea+meal group = 45 minutes');

var needAuto5 = PSR.needBoxesFromHours(
  [{ hours: 1, targetBph: 16, strikeBph: 14.6 }],
  1,
  5
);
check(needAuto5.hoursBasis === 'intra_less_breaks', '5h Intra auto-applies 15m');
check(Math.abs(needAuto5.hoursForNeed - 4.75) < 0.01, '5h Intra − 15m = 4.75h');
check(needAuto5.breakMinutes === 15, 'needBoxes stores 15m auto break');

var needAuto7 = PSR.needBoxesFromHours(
  [{ hours: 1, targetBph: 16, strikeBph: 14.6 }],
  1,
  7
);
check(needAuto7.breakMinutes === 45, '7h Intra → 45m auto break');
check(Math.abs(needAuto7.hoursForNeed - 6.25) < 0.01, '7h Intra − 45m = 6.25h');

var longIntra5 = [
  { 'Report Date Hour': '2026-08-13 08:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 },
  { 'Report Date Hour': '2026-08-13 09:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 },
  { 'Report Date Hour': '2026-08-13 10:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 },
  { 'Report Date Hour': '2026-08-13 11:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 },
  { 'Report Date Hour': '2026-08-13 12:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 }
];
var withAuto5 = PSR.buildReport(shortPack, 0, longIntra5);
check(withAuto5.morning[0].breakMinutes === 15, 'packer gets 15m auto break over 4h');
check(withAuto5.morning[0].hoursBasis === 'intra_less_breaks', 'report uses intra_less_breaks');
check(Math.abs(withAuto5.morning[0].shiftHours - 4.75) < 0.01, 'Shift h = 5 − 0.25');
check(Math.abs(withAuto5.morning[0].strikeBoxes - 4.75 * 14.6) < 0.01, 'strike need uses net hours');

var longIntra7 = longIntra5.concat([
  { 'Report Date Hour': '2026-08-13 13:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 },
  { 'Report Date Hour': '2026-08-13 07:00', 'Pnp Worker Name': 'Fair Strike', 'Boxes Packed': 8 }
]);
var withAuto7 = PSR.buildReport(shortPack, 0, longIntra7);
check(withAuto7.morning[0].breakMinutes === 45, 'packer gets 45m auto break over 6h');
check(Math.abs(withAuto7.morning[0].shiftHours - 6.25) < 0.01, 'Shift h = 7 − 0.75');

// Explicit map can still raise break minutes above auto (compat)
var withMap = PSR.buildReport(shortPack, 0, longIntra, [], [], {
  'Fair Strike|morning_shift': 45
});
check(withMap.morning[0].breakMinutes === 45, 'explicit map can exceed auto when Intra is only 4h');
check(Math.abs(withMap.morning[0].shiftHours - 3.25) < 0.01, 'Shift h is Intra minus map breaks');

console.log('\nPacker shift report JS — Total / avg uses Shift h when Intra scores');
var totPackOnly = PSR.summarizePackerTotalAvg({
  hoursBasis: 'packing',
  hours: 4.25,
  shiftHours: null,
  pctOfTarget: 168,
  flag: 'On/above target',
  skuLines: [
    { sku: 200, hours: 4.25, boxes: 121, targetBph: 17, strikeBph: 15.3, verdict: 'on/above target' }
  ]
});
check(Math.abs(totPackOnly.avgBph - 28.5) < 0.1, 'packing-basis Total BPH = boxes/Pack h');
check(totPackOnly.useShiftHours === false, 'packing-basis does not use Shift h');

var totShift = PSR.summarizePackerTotalAvg({
  hoursBasis: 'intra_less_breaks',
  hours: 4.25,
  shiftHours: 8,
  breakMinutes: 45,
  pctOfTarget: 89,
  flag: 'Below strike',
  skuLines: [
    { sku: 200, hours: 4.25, boxes: 121, targetBph: 17, strikeBph: 15.3, verdict: 'on/above target' }
  ]
});
check(totShift.useShiftHours === true, 'Intra-basis Total uses Shift h');
check(Math.abs(totShift.avgBph - (121 / 8)) < 0.1, 'Total BPH = boxes/Shift h (not Pack h)');
check(totShift.avgBph < totShift.avgStrike, 'Shift-basis BPH sits under strike — matches Below strike');
check(totShift.pctOfTarget === 89 && totShift.flag === 'Below strike', 'Total % / flag match packer score');

console.log('\nPacker shift report JS — Downtime paste for compare');
var dt = PSR.parseDowntimePaste('Packer\tDowntime\nAlice Smith\t45\nBob Jones\t30');
check(dt.byWorker['alice smith'] === 45 && dt.byWorker['bob jones'] === 30, 'parses TSV name + minutes');
check(PSR.parseDowntimeMinutesCell('1:15') === 75, 'parses H:MM downtime');
check(PSR.parseDowntimeMinutesCell('0.5', 'hours') === 30, 'hours column → minutes');
var withDt = PSR.buildReport(boxes, 0, intra, [], [], {}, dt.byWorker);
var aliceDt = withDt.morning.filter(function (r) { return r.workerDisplay === 'Alice Smith'; })[0];
check(aliceDt && aliceDt.downtimeMinutes === 45, 'Alice downtime = 45m for compare');
var flagBefore = PSR.buildReport(boxes, 0, intra).morning.filter(function (r) { return r.workerDisplay === 'Alice Smith'; })[0].flag;
check(aliceDt.flag === flagBefore, 'downtime is compare-only — flag unchanged vs no downtime');
var wbDt = PSR.buildExportWorkbook(withDt);
check(JSON.stringify(wbDt.Sheets['Morning shift']).indexOf('Downtime mins') !== -1,
  'Export includes Downtime mins column');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
