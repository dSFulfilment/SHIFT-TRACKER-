#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var PA = require('../js/packer-analytics.js');

var dir = path.join(__dirname, '..', 'fixtures');
var files = fs.readdirSync(dir).filter(function (f) {
  return f.endsWith('.csv');
});

var all = [];
var quality = PA.emptyQuality();
console.log('Verifying fixtures in', dir);
files.forEach(function (name) {
  var text = fs.readFileSync(path.join(dir, name), 'utf8');
  var res = PA.processCsvText(text, { sourceFile: name, defaultShift: 'morning_shift' });
  console.log('\n' + name);
  if (!res.ok) {
    console.log('  ERROR:', res.error);
    return;
  }
  console.log('  format:', res.format);
  console.log('  records:', res.records.length);
  console.log('  quality:', JSON.stringify(res.quality));
  var merged = PA.mergeRecords(all, res.records);
  var cross = all.length + res.records.length - merged.records.length;
  res.quality.duplicateRows += Math.max(0, cross);
  all = merged.records;
  quality = PA.mergeQuality(quality, res.quality);
});

var kpis = PA.aggregateKpis(all);
var workers = PA.aggregateWorkers(all);
console.log('\n=== Combined ===');
console.log('rows:', all.length);
console.log('workers:', workers.length);
console.log('KPIs:', JSON.stringify(kpis, null, 2));
console.log('quality:', JSON.stringify(quality, null, 2));
console.log(
  'top worker:',
  workers[0] && workers[0].workerName,
  'BPH',
  workers[0] && workers[0].boxesPerHour
);
