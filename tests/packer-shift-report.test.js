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
var summary = [
  { 'Report Date': '2026-08-13', 'Facility Name': 'Dandenong South', 'Pnp Worker Name': 'Alice Smith', 'Idle Time %': 0, 'Total Boxes Packed': 190, 'Packing Time (Hours)': 6, 'Boxes per Hour': 30 },
  { 'Report Date': '2026-08-13', 'Facility Name': 'Dandenong South', 'Pnp Worker Name': 'Bob Jones', 'Idle Time %': 0, 'Total Boxes Packed': 40, 'Packing Time (Hours)': 3, 'Boxes per Hour': 13 },
  { 'Report Date': '2026-08-13', 'Facility Name': 'Dandenong South', 'Pnp Worker Name': 'Eve Short', 'Idle Time %': 0, 'Total Boxes Packed': 2, 'Packing Time (Hours)': 0.17, 'Boxes per Hour': 12 }
];
var report = PSR.buildReport(boxes, summary, 0, []);
var morning = {};
report.morning.forEach(function (r) { morning[r.workerDisplay] = r; });
check(morning['Alice Smith'] && morning['Alice Smith'].flag === 'On/above target', 'Alice morning on/above');
check(Math.abs(morning['Alice Smith'].pctOfTarget - (130 / 110 * 100)) < 0.01, 'Alice % of target');
check(morning['Bob Jones'] && morning['Bob Jones'].flag === 'Below target', 'Bob below target');
check(morning['Bob Jones'].why && morning['Bob Jones'].why.indexOf('short by') !== -1, 'Bob why explains shortfall');
check(morning['Bob Jones'].skuLines && morning['Bob Jones'].skuLines.length >= 1, 'Bob has SKU breakdown');
check(report.morningTotals && report.morningTotals.packers === 2, 'Morning shift totals packers');
check(!morning['Eve Short'], 'Eve under 15 min excluded from morning');
check(report.afternoon.length === 1 && report.afternoon[0].workerDisplay === 'Alice Smith', 'Alice afternoon separate row');
check(report.exclusions.under_15_min === 1, 'under_15_min counted');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
