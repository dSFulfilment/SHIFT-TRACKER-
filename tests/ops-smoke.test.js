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
