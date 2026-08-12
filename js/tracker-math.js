/**
 * Tracker plan / finish math — pure helpers (browser + Node).
 * Breaks cut productive capacity the same way for the half-hour table,
 * finish estimates, and actual packing rate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TrackerMath = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toMin(hhmm) {
    if (hhmm == null || hhmm === '') return null;
    if (typeof hhmm === 'number' && isFinite(hhmm)) return hhmm;
    var s = String(hhmm);
    var m = /^(\d{1,2}):(\d{2})/.exec(s);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /** Productive minutes in [slotStart, slotEnd) after scheduled tea/meal. */
  function effectiveMins(slotStart, slotEnd, staff, groups) {
    var full = slotEnd - slotStart;
    if (full <= 0) return 0;
    if (!staff || staff <= 0 || !groups || !groups.length) return full;
    var lostPackerMinutes = 0;
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var count = (g.packer || []).length;
      if (!count) continue;
      var teaS = toMin(g.teaStart), teaE = toMin(g.teaEnd);
      if (teaS != null && teaE != null) {
        var tos = Math.max(slotStart, teaS), toe = Math.min(slotEnd, teaE);
        if (toe > tos) lostPackerMinutes += (toe - tos) * count;
      }
      var mealS = toMin(g.mealStart), mealE = toMin(g.mealEnd);
      if (mealS != null && mealE != null) {
        var mos = Math.max(slotStart, mealS), moe = Math.min(slotEnd, mealE);
        if (moe > mos) lostPackerMinutes += (moe - mos) * count;
      }
    }
    return Math.max(full - lostPackerMinutes / staff, 0);
  }

  function productiveHoursBetween(fromMin, toMin, staff, groups) {
    if (toMin <= fromMin) return 0;
    return effectiveMins(fromMin, toMin, staff, groups) / 60;
  }

  /**
   * Wall-clock minutes to pack `boxes` at `ratePerHour`, walking forward from
   * `fromMin` with break-adjusted capacity (same model as the plan table).
   */
  function wallMinsToPack(boxes, ratePerHour, fromMin, shiftEndMin, staff, groups) {
    if (!(boxes > 0)) return 0;
    if (!(ratePerHour > 0)) return Infinity;
    var left = boxes;
    var cur = fromMin;
    var hardEnd = Math.max(shiftEndMin || fromMin, fromMin) + 16 * 60;
    var guard = 0;
    while (left > 0.05 && cur < hardEnd && guard++ < 800) {
      var slotEnd = Math.min(cur + 30, hardEnd);
      var span = slotEnd - cur;
      if (span <= 0) break;
      var eff = effectiveMins(cur, slotEnd, staff, groups);
      if (eff <= 0) {
        cur = slotEnd;
        continue;
      }
      var canPack = ratePerHour * (eff / 60);
      if (canPack >= left) {
        var needProd = (left / ratePerHour) * 60;
        var dens = eff / span;
        cur += dens > 0 ? (needProd / dens) : span;
        left = 0;
        break;
      }
      left -= canPack;
      cur = slotEnd;
    }
    if (left > 0.05) return Infinity;
    return Math.max(0, cur - fromMin);
  }

  /** Boxes packed / productive hour — comparable to planned staff × bpph. */
  function actualPackRate(startBoxes, boxesLeftAtChk, shiftStart, chkMin, staff, groups) {
    var pk = startBoxes - boxesLeftAtChk;
    var ph = productiveHoursBetween(shiftStart, chkMin, staff, groups);
    if (!(ph > 0) || !(pk > 0)) return 0;
    return pk / ph;
  }

  /**
   * Project boxes left at `nmf` from a checkpoint actual (or starting boxes),
   * packing forward at `ratePerHour` with breaks out.
   */
  function projectBoxesLeft(boxesAtFrom, fromMin, nmf, ratePerHour, staff, groups) {
    if (nmf <= fromMin) return boxesAtFrom;
    var eff = effectiveMins(fromMin, nmf, staff, groups);
    var packed = ratePerHour * (eff / 60);
    return Math.max(0, boxesAtFrom - packed);
  }

  return {
    toMin: toMin,
    effectiveMins: effectiveMins,
    productiveHoursBetween: productiveHoursBetween,
    wallMinsToPack: wallMinsToPack,
    actualPackRate: actualPackRate,
    projectBoxesLeft: projectBoxesLeft
  };
});
