#!/usr/bin/env node
'use strict';

var TM = require('../js/tracker-math.js');
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

function approx(a, b, tol) {
  tol = tol == null ? 0.02 : tol;
  return Math.abs(a - b) <= tol;
}

console.log('\nTracker math — productive mins');
check(TM.effectiveMins(600, 630, 10, []) === 30, 'no breaks → full 30 mins');
check(TM.effectiveMins(630, 600, 10, []) === 0, 'inverted range → 0');

// All 10 packers on tea for the whole half-hour → 0 productive
var allTea = [{ packer: [1,2,3,4,5,6,7,8,9,10], teaStart: '10:00', teaEnd: '10:30' }];
check(approx(TM.effectiveMins(600, 630, 10, allTea), 0), 'full-team tea → 0 productive mins');

// Half the team on 15-min tea in a 30-min slot: lost = 15*5/10 = 7.5 → 22.5
var halfTea = [{ packer: [1,2,3,4,5], teaStart: '10:00', teaEnd: '10:15' }];
check(approx(TM.effectiveMins(600, 630, 10, halfTea), 22.5), 'half team 15m tea → 22.5 productive');

console.log('\nTracker math — wall finish with breaks');
// 600 boxes at 600/hr with no breaks from 10:00 → 60 wall mins
check(approx(TM.wallMinsToPack(600, 600, 600, 900, 10, []), 60), 'no-break finish = boxes/rate');

// Same but entire next hour is full-team break: need to skip break then finish
var longBreak = [{ packer: [1,2,3,4,5,6,7,8,9,10], mealStart: '10:00', mealEnd: '11:00' }];
var wall = TM.wallMinsToPack(600, 600, 600, 900, 10, longBreak);
check(approx(wall, 120), 'full-team meal hour pushes finish by +60m');

console.log('\nTracker math — actual rate vs wall clock');
// Packed 450 in 60 wall mins with half-team 15m tea once:
// lost = 15*5/10 = 7.5 → productive = 52.5 mins = 0.875 hr → rate ≈ 514.29
var groups = [{ packer: [1,2,3,4,5], teaStart: '10:00', teaEnd: '10:15' }];
var ar = TM.actualPackRate(1000, 550, 600, 660, 10, groups);
check(approx(ar, 450 / 0.875, 0.5), 'actual rate uses productive hours not wall clock');
var wallAr = 450 / 1;
check(ar > wallAr, 'productive rate is higher than naive wall-clock rate');

console.log('\nTracker math — project boxes left');
var left = TM.projectBoxesLeft(1000, 600, 630, 600, 10, []);
check(approx(left, 700), '30m at 600/hr → 300 packed, 700 left');
var leftBreak = TM.projectBoxesLeft(1000, 600, 630, 600, 10, allTea);
check(approx(leftBreak, 1000), 'full break → no boxes projected packed');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
