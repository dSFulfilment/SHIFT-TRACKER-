#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var PA = require('../js/packer-analytics.js');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ✗ ' + msg);
  }
}

function assertClose(a, b, msg, eps) {
  eps = eps == null ? 1e-6 : eps;
  assert(a != null && b != null && Math.abs(a - b) <= eps, msg + ' (got ' + a + ', expected ' + b + ')');
}

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

console.log('\nCSV parsing & header detection');
(function () {
  var text = readFixture('summary.csv');
  var res = PA.processCsvText(text, { sourceFile: 'summary.csv' });
  assert(res.ok, 'summary CSV parses ok');
  assert(res.format === 'summary', 'detects summary format');
  assert(res.fieldMap.workerName, 'maps worker name');
  assert(res.fieldMap.station, 'maps station');
  assert(res.fieldMap.boxes, 'maps boxes');
  // TOTALS row + blank worker skipped
  assert(res.quality.totalsRowsSkipped >= 1, 'skips TOTALS row');
  assert(res.quality.missingWorkerNames >= 1, 'counts missing worker names');
  var names = res.records.map(function (r) {
    return r.workerKey;
  });
  assert(names.indexOf('jane doe') !== -1, 'keeps Jane Doe');
  assert(names.indexOf('total') === -1, 'does not treat TOTAL as worker');
})();

console.log('\nWhitespace cleaning & name standardisation');
(function () {
  var res = PA.processCsvText(readFixture('summary.csv'));
  var janeRows = res.records.filter(function (r) {
    return r.workerKey === 'jane doe';
  });
  assert(janeRows.length >= 1, 'Jane Doe rows present');
  assert(janeRows[0].workerName === 'Jane Doe', 'display name keeps CSV casing');
  assert(PA.normalizeWorkerName("Avalon-Ophelia Paese").display === 'Avalon-Ophelia Paese', 'keeps hyphen casing');
  assert(PA.normalizeWorkerName("BREE POA").display === 'BREE POA', 'keeps ALL CAPS');
  assert(PA.normalizeWorkerName("O'Brien").display === "O'Brien", "keeps O'Brien casing");
  assert(janeRows.every(function (r) {
    return r.station.indexOf('Station') === 0;
  }), 'station names trimmed/standardised');
})();

console.log('\nDate / time parsing (AU)');
(function () {
  var res = PA.processCsvText(readFixture('hourly.csv'), { defaultShift: 'morning_shift' });
  assert(res.ok, 'hourly CSV ok');
  assert(res.records[0].reportDate === '2026-08-08', 'parses DD/MM/YYYY from hour key');
  assert(res.records[0].hour === 9, 'parses hour from hour key');
  assert(PA.formatDateAU('2026-08-08') === '08/08/2026', 'AU date format');
})();

console.log('\nNumeric conversion & missing values');
(function () {
  var p = PA.parseNum('');
  assert(p.valid && p.blank && p.value === null, 'blank → null not zero-forced at parse');
  var bad = PA.parseNum('N/A');
  assert(!bad.valid && bad.value === null, 'invalid numeric rejected');
  assert(PA.boxesPerHour(100, 0) === null, 'BPH with zero hours is null');
  assert(PA.boxesPerHour(100, null) === null, 'BPH with missing hours is null');
  assert(PA.formatRate(null) === 'N/A', 'null rates format as N/A');
})();

console.log('\nCalculations');
(function () {
  assertClose(PA.boxesPerHour(150, 8.5), 150 / 8.5, 'boxes per hour');
  assertClose(PA.itemsPerHour(2400, 4), 600, 'items per hour');
  assertClose(PA.pouchesPerHour(100, 2), 50, 'pouches per hour');
  assertClose(PA.secondsPerBox(3600, 100), 36, 'seconds per box');
  assertClose(PA.secondsPerItem(3600, 1200), 3, 'seconds per item');
  assertClose(PA.efficiencyVersusTarget(18.7, 17), 18.7 / 17, 'efficiency vs target');
  assertClose(PA.idlePercentage(0.8, 8), 0.1, 'idle percentage');
  var ex = PA.performanceStatus(1.15);
  assert(ex.key === 'excellent', 'status excellent ≥110%');
  var on = PA.performanceStatus(1.0);
  assert(on.key === 'on_target', 'status on target 95–109.99%');
  var need = PA.performanceStatus(0.9);
  assert(need.key === 'needs_attention', 'status needs attention <95%');
})();

console.log('\nDuplicate removal when combining files');
(function () {
  var a = PA.processCsvText(readFixture('hourly.csv'), { defaultShift: 'morning_shift' });
  var b = PA.processCsvText(readFixture('hourly.csv'), { defaultShift: 'morning_shift' });
  var merged = PA.mergeRecords(a.records, b.records);
  assert(merged.duplicatesRemoved > 0, 'detects duplicates across files');
  assert(merged.records.length === a.records.length, 'combined length equals unique set');
  // Within-file duplicate Jane 09:00 appears twice in fixture — only one kept
  var jane9 = a.records.filter(function (r) {
    return r.workerKey === 'jane doe' && r.hour === 9;
  });
  assert(jane9.length === 1, 'within-file duplicate collapsed');
})();

console.log('\nFiltering');
(function () {
  var res = PA.processCsvText(readFixture('detailed.csv'));
  assert(res.ok, 'detailed CSV ok');
  var onlyMorning = PA.filterRecords(res.records, { shift: 'morning_shift' });
  assert(onlyMorning.every(function (r) {
    return r.shiftKey === 'morning_shift';
  }), 'filter by shift');
  var priya = PA.filterRecords(res.records, { worker: 'priya nair' });
  assert(priya.length === 2, 'filter by worker');
  var minPerf = PA.filterRecords(res.records, { minPerformance: 20 });
  assert(minPerf.every(function (r) {
    return r.calc.boxesPerHour >= 20;
  }), 'min performance threshold');
})();

console.log('\nWeighted averages & worker ranking');
(function () {
  assertClose(PA.weightedAverage([
    { value: 10, weight: 1 },
    { value: 20, weight: 3 }
  ]), 17.5, 'weighted average');
  assert(PA.weightedAverage([{ value: 10, weight: 0 }]) === null, 'zero weight → null');
  var res = PA.processCsvText(readFixture('end-of-shift.csv'), { defaultShift: 'morning_shift' });
  var workers = PA.aggregateWorkers(res.records);
  assert(workers.length >= 3, 'aggregates workers');
  assert(workers[0].rank === 1, 'assigns ranks');
  assert(res.quality.mixedSkuRows >= 1, 'flags mixed SKU rows');
  assert(res.records.every(function (r) {
    return !r.sku || /^\d+$/.test(r.sku);
  }), 'SKU values are single numeric sizes or blank');
  assert(PA.normalizeSku('250 / 500') === '', 'slash mixed SKU blanked');
  var kpis = PA.aggregateKpis(res.records);
  assert(kpis.totalBoxes > 0, 'KPI total boxes');
  assert(kpis.activeWorkers >= 3, 'KPI active workers');
  // Weighted avg BPH = total boxes / total hours (not mean of row BPHs)
  assertClose(kpis.averageBoxesPerHour, kpis.totalBoxes / kpis.totalPackingHours, 'KPI avg BPH is weighted');
})();

console.log('\nInvalid / missing columns');
(function () {
  var bad = PA.processCsvText('Foo,Bar\n1,2\n');
  assert(!bad.ok, 'rejects CSV without worker column');
  assert(/worker-name|worker name/i.test(bad.error), 'clear error for missing worker column');
  var empty = PA.processCsvText('');
  assert(!empty.ok, 'rejects empty file');
})();

console.log('\nRaw data preserved');
(function () {
  var original = readFixture('summary.csv');
  var res = PA.processCsvText(original);
  assert(res.rawText === original || res.rawText === PA.stripBOM(original), 'raw text returned unchanged');
  assert(res.records[0].raw && typeof res.records[0].raw === 'object', 'row raw cells kept');
})();

console.log('\nSKU / shift standardisation');
(function () {
  assert(PA.normalizeSku('250g') === '250', 'SKU digits only');
  assert(PA.normalizeSku('250,500') === '', 'mixed SKU blanked');
  assert(PA.normalizeShift('Morning').key === 'morning_shift', 'shift Morning → morning_shift');
  assert(PA.normalizeShift('Twilight').known === false, 'unknown shift flagged');
})();

console.log('\nPeople merge + BPH target (Boxes Packed by Worker)');
(function () {
  var res = PA.processCsvText(readFixture('boxes-packed-by-worker.csv'), { sourceFile: 'boxes.csv' });
  assert(res.ok, 'real boxes CSV ok');
  var people = PA.aggregatePeopleRows(res.records.filter(function (r) {
    return r.shiftKey === 'afternoon_shift';
  }));
  assert(people.length > 0, 'people rows for afternoon');
  var avalon = people.filter(function (p) {
    return /avalon/i.test(p.workerName);
  })[0];
  assert(!!avalon, 'Avalon merged into one person');
  assert(avalon.skus.length >= 3, 'Avalon keeps multiple SKUs');
  assert(avalon.skus.every(function (s) { return s.strikeStatus && s.strikeStatus.key; }), 'each SKU has target status');
  assert(avalon.skus.every(function (s) { return s.needBoxes != null && s.needBoxes > 0; }), 'each SKU has need boxes (target × hours)');
  assert(typeof avalon.hitTarget === 'boolean', 'hitTarget flag present');
  assert(avalon.blendedTarget != null && avalon.blendedTarget > 0, 'person has blended BPH target');
  // With Intra Hour hours, need uses shift-hour share
  var merged = PA.mergeRecords(res.records.filter(function (r) { return r.shiftKey === 'afternoon_shift'; }),
    PA.processCsvText(readFixture('intra-hour-3pm.csv')).records.concat(
      PA.processCsvText(readFixture('intra-hour-2pm.csv')).records
    )).records;
  var people2 = PA.aggregatePeopleRows(merged);
  var a2 = people2.filter(function (p) { return /avalon/i.test(p.workerName); })[0];
  assert(!!a2 && a2.intraHours >= 2, 'Avalon gets Intra Hour shift hours');
  assert(a2.skus.every(function (s) { return s.hoursForTarget != null; }), 'SKU hours for target set');
  // Intra hour alone should not create people BPH rows
  var hour = PA.processCsvText(readFixture('intra-hour-3pm.csv'), { sourceFile: 'hour.csv' });
  assert(hour.ok && hour.format === 'hourly', 'intra hour format');
  assert(PA.aggregatePeopleRows(hour.records).length === 0, 'hourly-only does not invent BPH people rows');
  assert(PA.parseHourFromKey('2026-08-07 15:00:00.000') === 15, 'ISO hour key parses');
  assert(PA.parseReportDateFromHourKey('2026-08-07 15:00:00.000') === '2026-08-07', 'ISO hour date parses');
})();

console.log('\nOverall status uses blended avg BPH (not worst SKU)');
(function () {
  // 250 @ 0.5h with 5 boxes → strike on that SKU (need 8)
  // 500 @ 2h with 50 boxes → hit on that SKU (need 46)
  // Worst SKU = strike, but total 55 vs need 54 → overall hit
  var records = [
    {
      workerKey: 'test packer', workerName: 'Test Packer', sku: '250',
      boxes: 5, packingHours: 0.5, station: 'A', hour: null
    },
    {
      workerKey: 'test packer', workerName: 'Test Packer', sku: '500',
      boxes: 50, packingHours: 2, station: 'A', hour: null
    }
  ];
  var rows = PA.aggregatePeopleRows(records);
  assert(rows.length === 1, 'one merged person');
  var p = rows[0];
  var sku250 = p.skus.filter(function (s) { return s.sku === '250'; })[0];
  var sku500 = p.skus.filter(function (s) { return s.sku === '500'; })[0];
  assert(!!sku250 && sku250.strikeStatus.key === 'strike', '250 SKU chip stays strike');
  assert(!!sku500 && sku500.strikeStatus.key === 'on', '500 SKU chip stays hit');
  assert(p.strikeStatus.key === 'on', 'person status is hit from blended avg (not worst SKU)');
  assert(p.hitTarget === true, 'hitTarget follows blended overall');
  assertClose(p.needBoxes, 8 + 46, 'blended need boxes = sum of SKU needs');
  assertClose(p.boxesPerHour, 55 / 2.5, 'overall BPH = total boxes ÷ packing hours');
})();

console.log('\n────────────────────────────────');
console.log('Passed: ' + passed + '  Failed: ' + failed);
process.exit(failed ? 1 : 0);
