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
check(morning['Bob Jones'] && morning['Bob Jones'].flag === 'Below target', 'Bob below target');
check(morning['Bob Jones'].why && morning['Bob Jones'].why.indexOf('short by') !== -1, 'Bob why explains shortfall');
check(morning['Bob Jones'].skuLines && morning['Bob Jones'].skuLines.length >= 1, 'Bob has SKU breakdown');
check(report.morningTotals && report.morningTotals.packers === 3, 'Morning shift totals packers');
check(morning['Eve Short'] && morning['Eve Short'].flag === 'Below target', 'Eve short line still scored');
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
check(wb.SheetNames.indexOf('By hour') !== -1, 'Export has By hour sheet');
var buf = PSR.workbookToArrayBuffer(wb);
check(buf && buf.byteLength > 1000, 'Export workbook writes bytes');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
