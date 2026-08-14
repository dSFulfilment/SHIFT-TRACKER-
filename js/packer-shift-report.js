/**
 * Dandenong South packer shift performance-vs-target (browser + Node).
 * Mirrors packer_shift_report/ Python rules. Scores from Boxes Packed; Intra is reference only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PackerShiftReport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SKU_TARGETS = {
    125: { target: 17, strike: 15.7 },
    150: { target: 18, strike: 16.3 },
    200: { target: 17, strike: 15.3 },
    250: { target: 16, strike: 14.6 },
    300: { target: 18, strike: 16.0 },
    400: { target: 16, strike: 14.6 },
    500: { target: 23, strike: 20.6 },
    600: { target: 20, strike: 17.8 },
    700: { target: 21, strike: 19.0 }
  };
  var FACILITY_NAME = 'Dandenong South';

  var BOXES_COLS = [
    'Report Date', 'Shift', 'Pnp Worker Name', 'Station Name', 'Primary Sku',
    'Boxes Packed', 'Items Packed', 'Pouches Packed', 'Packing Time Seconds',
    'Seconds per Item', 'Pouches per Hour'
  ];
  var INTRA_COLS = ['Report Date Hour', 'Pnp Worker Name', 'Boxes Packed'];
  // Canonical names after HEADER_ALIASES (Raw Data CSV uses "Packing Time (Seconds)" → Packing Time Seconds).
  var RAW_DATA_COLS = [
    'Report Date', 'Facility Name', 'Pnp Worker Name', 'First Scan', 'Last Scan',
    'Packing Time Seconds', 'Total Boxes Packed', 'Packing Time (Hours)',
    'Boxes per Hour', 'Box Sku Sizes'
  ];
  // Optional on Raw Data — used for shift length when present (Dandenong South only).
  var RAW_SHIFT_HOURS_COL = 'Shift (Hours)';
  var EXEC_SUMMARY_COLS = ['Pnp Worker Name', 'Packing Time (Hours)'];
  var EXEC_SUMMARY_OPTIONAL = ['Facility Name', 'Average Direct Hours Per Day', 'Total Boxes Packed', 'Boxes per Hour'];

  function normHeader(h) {
    return String(h == null ? '' : h).trim().replace(/\s+/g, ' ');
  }
  function headerKey(h) {
    return normHeader(h).toLowerCase();
  }
  // Real exports sometimes tweak punctuation/casing — map aliases → canonical names.
  var HEADER_ALIASES = {
    'report date': 'Report Date',
    'shift': 'Shift',
    'pnp worker name': 'Pnp Worker Name',
    'pnp worker': 'Pnp Worker Name',
    'worker name': 'Pnp Worker Name',
    'station name': 'Station Name',
    'station': 'Station Name',
    'primary sku': 'Primary Sku',
    'primary skus': 'Primary Sku',
    'sku': 'Primary Sku',
    'boxes packed': 'Boxes Packed',
    'items packed': 'Items Packed',
    'pouches packed': 'Pouches Packed',
    'packing time seconds': 'Packing Time Seconds',
    'packing time (seconds)': 'Packing Time Seconds',
    'packing timeseconds': 'Packing Time Seconds',
    'seconds per item': 'Seconds per Item',
    'pouches per hour': 'Pouches per Hour',
    'report date hour': 'Report Date Hour',
    'idle time %': 'Idle Time %',
    'idle time': 'Idle Time %',
    'box dynamic efficiency %': 'Box Dynamic Efficiency %',
    'boxes per hour': 'Boxes per Hour',
    'first scan': 'First Scan',
    'last scan': 'Last Scan',
    'shift (hours)': 'Shift (Hours)',
    'shift hours': 'Shift (Hours)',
    'packing time (hours)': 'Packing Time (Hours)',
    'packing time hours': 'Packing Time (Hours)',
    'total boxes packed': 'Total Boxes Packed',
    'box sku sizes': 'Box Sku Sizes',
    'box sku size': 'Box Sku Sizes',
    'sku sizes': 'Box Sku Sizes',
    'facility name': 'Facility Name',
    'facility': 'Facility Name',
    'average direct hours per day': 'Average Direct Hours Per Day',
    'days worked': 'Days Worked',
    'quartile (vs. own facility)': 'Quartile (vs. own facility)',
    'quartile (vs. company wide)': 'Quartile (vs. company wide)',
    'seconds per box': 'Seconds per Box'
  };
  function canonicalizeHeader(h) {
    var n = normHeader(h);
    if (!n) return '';
    var mapped = HEADER_ALIASES[headerKey(n)];
    return mapped || n;
  }
  function blank(v) {
    return v == null || String(v).trim() === '';
  }
  function workerKey(name) {
    return String(name).trim().replace(/\s+/g, ' ');
  }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    var n = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function parseSku(v) {
    if (blank(v)) return null;
    if (typeof v === 'number' && isFinite(v)) return Math.round(v) === v ? Math.round(v) : v;
    var n = parseFloat(String(v).trim());
    if (!isFinite(n)) return String(v).trim();
    return Math.round(n) === n ? Math.round(n) : n;
  }
  function shiftParts(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (s === 'morning_shift' || s === 'morning' || s === 'day' || s === 'day_shift') {
      return { key: 'morning_shift', label: 'Morning' };
    }
    if (s === 'afternoon_shift' || s === 'afternoon' || s === 'arvo') {
      return { key: 'afternoon_shift', label: 'Afternoon' };
    }
    return { key: s || 'unknown_shift', label: raw ? String(raw).trim() : 'Unknown' };
  }

  function validateHeaders(fileLabel, headers, required) {
    var canon = headers.map(canonicalizeHeader);
    while (canon.length && canon[canon.length - 1] === '') canon.pop();
    var set = {};
    canon.forEach(function (h) { if (h) set[h] = true; });
    var missing = required.filter(function (c) { return !set[c]; });
    if (missing.length) {
      var found = canon.filter(Boolean);
      var err = new Error(
        fileLabel + ': missing required column(s): ' + missing.join(', ') +
        '. Found headers: ' + (found.join(', ') || '(none)') +
        '. Fix the export or rename columns back — do not guess.'
      );
      err.code = 'COLUMN_VALIDATION';
      err.fileLabel = fileLabel;
      err.missing = missing;
      err.found = found;
      throw err;
    }
    return canon;
  }

  function findHeaderRow(aoa, required) {
    var need = required.map(headerKey);
    var maxScan = Math.min(aoa.length, 20);
    for (var r = 0; r < maxScan; r++) {
      var row = aoa[r] || [];
      var keys = {};
      for (var i = 0; i < row.length; i++) {
        var c = canonicalizeHeader(row[i]);
        if (c) keys[headerKey(c)] = true;
      }
      var hits = 0;
      for (var n = 0; n < need.length; n++) {
        if (keys[need[n]]) hits++;
      }
      // Enough required names on this row to treat it as the header
      if (hits >= Math.min(4, need.length) || hits === need.length) {
        return r;
      }
    }
    return 0;
  }

  function sheetToRows(workbook, fileLabel, required) {
    var sheetName = workbook.SheetNames[0];
    var sheet = workbook.Sheets[sheetName];
    var aoa = rootXLSX().utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    if (!aoa.length) {
      validateHeaders(fileLabel, [], required);
      return [];
    }
    var headerIdx = findHeaderRow(aoa, required);
    var headers = validateHeaders(fileLabel, aoa[headerIdx], required);
    var rows = [];
    for (var r = headerIdx + 1; r < aoa.length; r++) {
      var line = aoa[r] || [];
      var obj = {};
      var any = false;
      headers.forEach(function (h, i) {
        if (!h) return;
        obj[h] = line[i] != null ? line[i] : null;
        if (!blank(obj[h])) any = true;
      });
      if (any) rows.push(obj);
    }
    return rows;
  }

  function rootXLSX() {
    var X = (typeof XLSX !== 'undefined') ? XLSX : null;
    if (!X && typeof window !== 'undefined') X = window.XLSX;
    if (!X && typeof global !== 'undefined') X = global.XLSX;
    if (!X && typeof require === 'function') {
      try { X = require('./xlsx.mini.min.js'); } catch (e1) {
        try { X = require('../js/xlsx.mini.min.js'); } catch (e2) { X = null; }
      }
    }
    if (!X) throw new Error('SheetJS (XLSX) is not loaded');
    return X;
  }

  function loadBoxesRows(rows) {
    var kept = [];
    var droppedBlank = 0;
    rows.forEach(function (d) {
      if (blank(d['Pnp Worker Name']) || blank(d['Primary Sku'])) {
        if (blank(d['Pnp Worker Name']) && blank(d['Primary Sku']) && blank(d['Boxes Packed'])) return;
        droppedBlank += 1;
        return;
      }
      kept.push(d);
    });
    return { rows: kept, droppedBlank: droppedBlank };
  }

  function loadIntraRows(rows) {
    var kept = [];
    rows.forEach(function (d) {
      if (blank(d['Pnp Worker Name'])) return;
      kept.push(d);
    });
    return kept;
  }

  /** "250g, 600g" / "700g" → numeric SKU list; mixed when >1. */
  function parseBoxSkuSizes(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { label: '', skus: [], isMixed: false };
    var nums = s.match(/\d+/g) || [];
    var skus = [];
    var seen = {};
    nums.forEach(function (n) {
      var v = parseInt(n, 10);
      if (!isFinite(v) || seen[v]) return;
      // Prefer weight-like SKUs in our table (125–700); keep others too
      seen[v] = true;
      skus.push(v);
    });
    return {
      label: s,
      skus: skus,
      isMixed: skus.length > 1 || /[,\/]| and /i.test(s)
    };
  }

  function stripBOM(text) {
    text = String(text == null ? '' : text);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function parseCSV(text) {
    text = stripBOM(text);
    var rows = [];
    var field = '';
    var row = [];
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') {
          row.push(field);
          field = '';
        } else if (c === '\n') {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else if (c === '\r') {
          /* skip */
        } else field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.length > 1 || (r.length === 1 && String(r[0]).trim() !== '');
    });
  }

  function csvTextToSheetRows(text, fileLabel, required) {
    var aoa = parseCSV(text);
    if (!aoa.length) throw new Error(fileLabel + ': empty file.');
    var headers = aoa[0].map(canonicalizeHeader);
    validateHeaders(fileLabel, headers, required);
    var rows = [];
    for (var r = 1; r < aoa.length; r++) {
      var line = aoa[r];
      var obj = {};
      var any = false;
      headers.forEach(function (h, i) {
        if (!h) return;
        obj[h] = line[i] != null ? line[i] : null;
        if (!blank(obj[h])) any = true;
      });
      if (any) rows.push(obj);
    }
    return rows;
  }

  function loadRawDataRows(rows) {
    var kept = [];
    var droppedFacility = 0;
    var droppedBlank = 0;
    (rows || []).forEach(function (d) {
      var display = String(d['Pnp Worker Name'] == null ? '' : d['Pnp Worker Name']).trim();
      if (!display) {
        droppedBlank += 1;
        return;
      }
      var fac = String(d['Facility Name'] == null ? '' : d['Facility Name']).trim().toLowerCase();
      if (fac && fac !== FACILITY_NAME.toLowerCase()) {
        droppedFacility += 1;
        return;
      }
      var sizes = parseBoxSkuSizes(d['Box Sku Sizes']);
      var boxes = num(d['Total Boxes Packed']);
      var seconds = num(d['Packing Time Seconds'] != null ? d['Packing Time Seconds'] : d['Packing Time (Seconds)']);
      var hours = num(d['Packing Time (Hours)'] != null ? d['Packing Time (Hours)'] : d['Packing Time Hours']);
      if (hours == null && seconds != null) hours = seconds / 3600;
      var bph = num(d['Boxes per Hour']);
      if (bph == null && hours && hours > 0 && boxes != null) bph = boxes / hours;
      var idlePct = num(d['Idle Time %'] != null ? d['Idle Time %'] : d['Idle Time']);
      var shiftHours = num(d['Shift (Hours)'] != null ? d['Shift (Hours)'] : d['Shift Hours']);
      var first = d['First Scan'];
      var shiftGuess = 'unknown_shift';
      var parsedFirst = parseReportDateHour(first);
      if (parsedFirst) shiftGuess = shiftKeyFromClockHour(parsedFirst.hour);
      kept.push({
        reportDate: d['Report Date'],
        facilityName: d['Facility Name'],
        workerDisplay: display,
        workerKey: workerKey(display),
        firstScan: first,
        lastScan: d['Last Scan'],
        packingSeconds: seconds,
        hours: hours,
        shiftHours: shiftHours,
        boxes: boxes,
        actualBph: bph,
        idlePct: idlePct,
        boxSkuSizes: sizes.label,
        skus: sizes.skus,
        isMixed: sizes.isMixed,
        shiftKey: shiftGuess,
        shiftLabel: shiftGuess === 'afternoon_shift' ? 'Afternoon' : (shiftGuess === 'morning_shift' ? 'Morning' : 'Unknown'),
        skuTargets: sizes.skus.map(function (sku) {
          return SKU_TARGETS[sku] ? { sku: sku, target: SKU_TARGETS[sku].target, strike: SKU_TARGETS[sku].strike } : { sku: sku, target: null, strike: null };
        })
      });
    });
    return { rows: kept, droppedFacility: droppedFacility, droppedBlank: droppedBlank };
  }

  /**
   * Executive Summary — one row per worker. Prefer Dandenong South only:
   * if Facility Name is present, drop other sites; if absent, treat as already DS-only.
   */
  function loadExecutiveSummaryRows(rows) {
    var kept = [];
    var droppedFacility = 0;
    var droppedBlank = 0;
    var hasFacilityCol = false;
    (rows || []).forEach(function (d) {
      if (Object.prototype.hasOwnProperty.call(d, 'Facility Name')) hasFacilityCol = true;
    });
    (rows || []).forEach(function (d) {
      var display = String(d['Pnp Worker Name'] == null ? '' : d['Pnp Worker Name']).trim();
      if (!display) {
        droppedBlank += 1;
        return;
      }
      if (hasFacilityCol) {
        var fac = String(d['Facility Name'] == null ? '' : d['Facility Name']).trim().toLowerCase();
        if (fac && fac !== FACILITY_NAME.toLowerCase()) {
          droppedFacility += 1;
          return;
        }
        if (!fac) {
          droppedFacility += 1;
          return;
        }
      }
      var hours = num(d['Packing Time (Hours)']);
      if (hours == null) hours = num(d['Average Direct Hours Per Day']);
      var seconds = num(d['Packing Time (Seconds)'] != null ? d['Packing Time (Seconds)'] : d['Packing Time Seconds']);
      if (hours == null && seconds != null) hours = seconds / 3600;
      kept.push({
        workerDisplay: display,
        workerKey: workerKey(display),
        facilityName: hasFacilityCol ? d['Facility Name'] : FACILITY_NAME,
        packingHours: hours,
        shiftHours: hours, // Exec Summary packing/direct hours = day hours for this export
        boxes: num(d['Total Boxes Packed']),
        actualBph: num(d['Boxes per Hour']),
        packingSeconds: seconds
      });
    });
    return {
      rows: kept,
      droppedFacility: droppedFacility,
      droppedBlank: droppedBlank,
      facilityFiltered: hasFacilityCol
    };
  }

  /** Max Shift (Hours) per worker from Dandenong South Raw Data rows. */
  function shiftHoursByWorker(rawDataRows) {
    var by = {};
    (rawDataRows || []).forEach(function (r) {
      if (r.shiftHours == null || !isFinite(r.shiftHours)) return;
      if (!by[r.workerKey] || r.shiftHours > by[r.workerKey]) {
        by[r.workerKey] = r.shiftHours;
      }
    });
    return by;
  }

  function execHoursByWorker(execRows) {
    var by = {};
    (execRows || []).forEach(function (r) {
      if (r.shiftHours == null || !isFinite(r.shiftHours)) return;
      by[r.workerKey] = r.shiftHours;
    });
    return by;
  }

  function rawDataMixedSummary(rawDataRows) {
    var mixed = (rawDataRows || []).filter(function (r) { return r.isMixed; });
    var byWorker = {};
    mixed.forEach(function (r) {
      if (!byWorker[r.workerKey]) {
        byWorker[r.workerKey] = {
          workerDisplay: r.workerDisplay,
          workerKey: r.workerKey,
          segments: [],
          boxes: 0,
          hours: 0,
          skuSet: {}
        };
      }
      byWorker[r.workerKey].segments.push(r);
      byWorker[r.workerKey].boxes += r.boxes || 0;
      byWorker[r.workerKey].hours += r.hours || 0;
      (r.skus || []).forEach(function (s) { byWorker[r.workerKey].skuSet[s] = true; });
    });
    return Object.keys(byWorker).map(function (k) {
      var w = byWorker[k];
      var skus = Object.keys(w.skuSet).map(Number).sort(function (a, b) { return a - b; });
      return {
        workerDisplay: w.workerDisplay,
        workerKey: w.workerKey,
        segments: w.segments,
        segmentCount: w.segments.length,
        boxes: w.boxes,
        hours: w.hours,
        skus: skus,
        mixLabel: skus.join(' · ')
      };
    }).sort(function (a, b) { return a.workerDisplay.localeCompare(b.workerDisplay); });
  }

  /** Intra has no SKU — clock hour ≥ 14 → Afternoon (same rule as analytics). */
  function shiftKeyFromClockHour(h) {
    return h >= 14 ? 'afternoon_shift' : 'morning_shift';
  }

  function parseReportDateHour(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      return {
        date: v,
        hour: v.getHours(),
        label: (v.getHours() < 10 ? '0' : '') + v.getHours() + ':00',
        sortKey: v.getTime()
      };
    }
    var s = String(v).trim();
    // "2026-08-13 14:00" / "2026-08-13T14:00:00" / Excel-ish
    var m = s.match(/(\d{1,2}):(\d{2})/);
    var hour = m ? parseInt(m[1], 10) : null;
    if (hour == null || !isFinite(hour)) return null;
    var label = (hour < 10 ? '0' : '') + hour + ':00';
    var day = s.slice(0, 10);
    return { date: s, hour: hour, label: label, sortKey: day + 'T' + label };
  }

  function normalizeIntraHours(intraRows) {
    var out = [];
    (intraRows || []).forEach(function (d) {
      var display = String(d['Pnp Worker Name']).trim();
      if (!display) return;
      var boxes = num(d['Boxes Packed']);
      if (boxes == null) return;
      var parsed = parseReportDateHour(d['Report Date Hour']);
      if (!parsed) return;
      out.push({
        reportDateHour: d['Report Date Hour'],
        hourLabel: parsed.label,
        hour: parsed.hour,
        sortKey: parsed.sortKey,
        shiftKey: shiftKeyFromClockHour(parsed.hour),
        shiftLabel: parsed.hour >= 14 ? 'Afternoon' : 'Morning',
        workerDisplay: display,
        workerKey: workerKey(display),
        boxes: boxes
      });
    });
    out.sort(function (a, b) {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      return a.workerDisplay.localeCompare(b.workerDisplay);
    });
    return out;
  }

  function hourLinesFor(workerKeyName, shiftKey, hourLines) {
    return (hourLines || []).filter(function (h) {
      return h.workerKey === workerKeyName && h.shiftKey === shiftKey;
    });
  }

  /** Count Intra clock-hour rows per worker+shift (= shift length in hours). */
  function intraHoursByWorkerShift(hourLines) {
    var by = {};
    (hourLines || []).forEach(function (h) {
      var k = h.workerKey + '|' + h.shiftKey;
      by[k] = (by[k] || 0) + 1;
    });
    return by;
  }

  function hmToMinutes(hm) {
    if (hm == null || hm === '') return null;
    var m = String(hm).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (!isFinite(h) || !isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  function minutesBetweenHm(start, end) {
    var a = hmToMinutes(start);
    var b = hmToMinutes(end);
    if (a == null || b == null) return 0;
    var d = b - a;
    if (d < 0) d += 24 * 60;
    return d;
  }

  /**
   * Auto breaks from shift length (all packers):
   * — over 4 hours → 15 min
   * — over 6 hours → +30 min (45 total)
   */
  function autoBreakMinutes(shiftHours) {
    if (shiftHours == null || !isFinite(shiftHours) || shiftHours <= 0) return 0;
    var mins = 0;
    if (shiftHours > 4) mins += 15;
    if (shiftHours > 6) mins += 30;
    return mins;
  }

  /** Tea (often ~15m) + Meal (often ~30m) from a Breaks group time range (legacy helper). */
  function breakMinutesForGroup(g) {
    if (!g) return 0;
    return minutesBetweenHm(g.teaStart, g.teaEnd) + minutesBetweenHm(g.mealStart, g.mealEnd);
  }

  /**
   * Map workerKey|shiftKey → break minutes from Breaks planner groups.
   * idToName: { rosterId: displayName }. Uses actual tea/meal ranges (15m / 30m typical).
   */
  function breakMinutesByWorkerShift(groupsByShift, idToNameByShift) {
    var out = {};
    ['morning_shift', 'afternoon_shift', 'morning', 'afternoon'].forEach(function (sk) {
      var groups = groupsByShift && groupsByShift[sk];
      if (!groups) return;
      var shiftKey = sk.indexOf('afternoon') !== -1 ? 'afternoon_shift' : 'morning_shift';
      var idToName = (idToNameByShift && (idToNameByShift[sk] || idToNameByShift[shiftKey])) || {};
      (groups || []).forEach(function (g) {
        var mins = breakMinutesForGroup(g);
        if (!(mins > 0)) return;
        ['packer', 'runner', 'boxmaker'].forEach(function (role) {
          (g[role] || []).forEach(function (id) {
            var name = idToName[id];
            if (!name) return;
            var key = workerKey(name) + '|' + shiftKey;
            // One group per person expected; keep the larger allotment if duplicated.
            if (out[key] == null || mins > out[key]) out[key] = mins;
          });
        });
      });
    });
    return out;
  }

  /**
   * Build break-minutes lookup from saved Breaks + Floor planner payloads.
   * Prefer byDate[dateKey]; fall back to template morning/afternoon groups.
   */
  function breakMinutesLookupFromStorage(bpData, plannerData, dateKey) {
    var groupsByShift = {};
    var idToNameByShift = {};
    function groupsFor(shift) {
      var day = bpData && bpData.byDate && dateKey && bpData.byDate[dateKey];
      if (day && day[shift] && day[shift].groups && day[shift].groups.length) return day[shift].groups;
      if (bpData && bpData[shift] && bpData[shift].groups) return bpData[shift].groups;
      return [];
    }
    function namesFor(shift) {
      var map = {};
      var sd = plannerData && plannerData.shiftData && plannerData.shiftData[shift];
      ((sd && sd.staffRoster) || []).forEach(function (p) {
        if (p && p.id && p.name) map[p.id] = p.name;
      });
      return map;
    }
    groupsByShift.morning = groupsFor('morning');
    groupsByShift.afternoon = groupsFor('afternoon');
    idToNameByShift.morning = namesFor('morning');
    idToNameByShift.afternoon = namesFor('afternoon');
    return breakMinutesByWorkerShift(groupsByShift, idToNameByShift);
  }

  /**
   * Need boxes for target/strike using Intra shift length when available.
   * Share Intra hours across SKUs by Boxes packing-time weight (fairer strike bar).
   * Subtract auto breaks (15m over 4h, +30m over 6h) unless breakMinutes is passed explicitly.
   * Falls back to packing hours when Intra has no usable hours for that packer+shift.
   */
  function needBoxesFromHours(knownLines, packHours, intraHours, breakMinutes) {
    var brk = (breakMinutes != null && isFinite(breakMinutes))
      ? breakMinutes
      : autoBreakMinutes(intraHours);
    var breakH = (brk != null && isFinite(brk) && brk > 0) ? (brk / 60) : 0;
    var effectiveIntra = null;
    if (intraHours != null && isFinite(intraHours) && intraHours > 0) {
      effectiveIntra = Math.max(0, intraHours - breakH);
      if (effectiveIntra <= 0) effectiveIntra = null;
    }
    var useIntra = effectiveIntra != null && packHours != null && isFinite(packHours) && packHours > 0;
    var targetBoxes = 0;
    var strikeBoxes = 0;
    (knownLines || []).forEach(function (L) {
      var skuHours = L.hours || 0;
      var hoursForNeed = useIntra ? (effectiveIntra * (skuHours / packHours)) : skuHours;
      if (L.targetBph != null) targetBoxes += hoursForNeed * L.targetBph;
      if (L.strikeBph != null) strikeBoxes += hoursForNeed * L.strikeBph;
    });
    return {
      targetBoxes: targetBoxes,
      strikeBoxes: strikeBoxes,
      hoursBasis: useIntra ? (breakH > 0 ? 'intra_less_breaks' : 'intra') : 'packing',
      hoursForNeed: useIntra ? effectiveIntra : packHours,
      intraHours: intraHours != null ? intraHours : null,
      breakMinutes: breakH > 0 ? brk : 0,
      breakHours: breakH
    };
  }

  /**
   * Total / avg row for By SKU: use same hours basis as packer % / flag
   * (Intra − breaks when present) so packing BPH does not contradict the flag.
   */
  function summarizePackerTotalAvg(packer) {
    var r = packer || {};
    var skuLines = (r.skuLines || []).filter(function (L) {
      return !(L.verdict && String(L.verdict).indexOf('excluded') === 0);
    });
    var totHours = 0;
    var totBoxes = 0;
    var knownHours = 0;
    var knownTargetBoxes = 0;
    var knownStrikeHours = 0;
    var knownStrikeWeight = 0;
    skuLines.forEach(function (L) {
      totHours += L.hours || 0;
      totBoxes += L.boxes || 0;
      if (L.targetBph != null && L.hours != null) {
        knownHours += L.hours;
        knownTargetBoxes += L.hours * L.targetBph;
      }
      if (L.strikeBph != null && L.hours != null) {
        knownStrikeHours += L.hours;
        knownStrikeWeight += L.hours * L.strikeBph;
      }
    });
    var useShift = (r.hoursBasis === 'intra' || r.hoursBasis === 'intra_less_breaks')
      && r.shiftHours != null && r.shiftHours > 0;
    var hoursForAvg = useShift ? r.shiftHours : totHours;
    var avgBph = hoursForAvg > 0 ? totBoxes / hoursForAvg : null;
    var avgTarget = knownHours > 0 ? knownTargetBoxes / knownHours : null;
    var avgStrike = knownStrikeHours > 0 ? knownStrikeWeight / knownStrikeHours : null;
    var overallPct = r.pctOfTarget != null
      ? r.pctOfTarget
      : (knownTargetBoxes > 0 ? (totBoxes / knownTargetBoxes * 100) : null);
    return {
      packHours: totHours,
      shiftHours: useShift ? r.shiftHours : null,
      breakMinutes: r.breakMinutes || 0,
      useShiftHours: useShift,
      hoursForAvg: hoursForAvg,
      boxes: totBoxes,
      avgBph: avgBph,
      avgTarget: avgTarget,
      avgStrike: avgStrike,
      pctOfTarget: overallPct,
      flag: r.flag || null
    };
  }

  function buildByHour(hourLines, morning, afternoon) {
    var packerByWorkerShift = {};
    function index(rows) {
      (rows || []).forEach(function (r) {
        packerByWorkerShift[r.workerKey + '|' + r.shiftKey] = {
          mix: r.skuMix || null,
          skus: (r.skuLines || []).map(function (L) {
            return { sku: L.sku, boxes: L.boxes, hours: L.hours, verdict: L.verdict };
          }),
          packHours: r.hours,
          boxesFile: r.boxes,
          intraHours: r.intraHours != null ? r.intraHours : ((r.hourLines && r.hourLines.length) || null),
          intraBoxes: r.intraBoxes != null ? r.intraBoxes : null,
          shiftHours: r.shiftHours,
          targetBoxes: r.targetBoxes,
          pctOfTarget: r.pctOfTarget,
          flag: r.flag,
          boxGap: r.boxGap
        };
      });
    }
    index(morning);
    index(afternoon);

    var byHour = {};
    (hourLines || []).forEach(function (h) {
      var k = h.sortKey + '|' + h.hourLabel;
      if (!byHour[k]) {
        byHour[k] = {
          hourLabel: h.hourLabel,
          sortKey: h.sortKey,
          shiftKey: h.shiftKey,
          shiftLabel: h.shiftLabel,
          boxes: 0,
          packers: []
        };
      }
      byHour[k].boxes += h.boxes;
      var boxesScore = packerByWorkerShift[h.workerKey + '|' + h.shiftKey] || null;
      byHour[k].packers.push({
        workerDisplay: h.workerDisplay,
        workerKey: h.workerKey,
        boxes: h.boxes,
        skuInfo: boxesScore
          ? { mix: boxesScore.mix, skus: boxesScore.skus }
          : { mix: null, skus: [] },
        boxesScore: boxesScore
      });
    });
    return Object.keys(byHour).map(function (k) { return byHour[k]; }).sort(function (a, b) {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      return 0;
    });
  }

  function buildReport(boxesRows, boxesDroppedBlank, intraRows, rawDataRows, execSummaryRows, breakMinutesByWorkerShiftMap) {
    var exclusions = {
      blank_worker_or_sku: boxesDroppedBlank || 0,
      missing_boxes: 0,
      missing_time: 0,
      unknown_sku_lines: 0
    };
    var warnings = [];
    var hourLinesAll = normalizeIntraHours(intraRows);
    var rawDataAll = rawDataRows || [];
    var rawDataMixed = rawDataMixedSummary(rawDataAll);
    var rawDataByWorker = {};
    rawDataAll.forEach(function (r) {
      if (!rawDataByWorker[r.workerKey]) rawDataByWorker[r.workerKey] = [];
      rawDataByWorker[r.workerKey].push(r);
    });
    var execAll = execSummaryRows || [];
    var intraHoursMap = intraHoursByWorkerShift(hourLinesAll);
    // Optional map kept for compatibility; auto breaks (15m >4h, +30m >6h) always apply.
    var breakMinutesMap = breakMinutesByWorkerShiftMap || {};
    // Prefer Intra clock-hour count (minus auto breaks) for shift length.
    // Raw Data / Exec Summary Shift (Hours) are not used for Shift h yet.
    function resolveShiftHours(workerKey, shiftKey) {
      var ik = workerKey + '|' + shiftKey;
      if (intraHoursMap[ik] != null && intraHoursMap[ik] > 0) {
        var intraH = intraHoursMap[ik];
        var brk = autoBreakMinutes(intraH);
        if (breakMinutesMap[ik] != null && isFinite(breakMinutesMap[ik]) && breakMinutesMap[ik] > brk) {
          brk = breakMinutesMap[ik];
        }
        var eff = Math.max(0, intraH - (brk > 0 ? brk / 60 : 0));
        if (eff > 0) {
          return {
            shiftHours: eff,
            shiftHoursSource: brk > 0 ? 'intra_less_breaks' : 'intra',
            intraHours: intraH,
            breakMinutes: brk > 0 ? brk : 0
          };
        }
      }
      return { shiftHours: null, shiftHoursSource: null, intraHours: null, breakMinutes: 0 };
    }

    var raw = [];
    (boxesRows || []).forEach(function (r) {
      var display = String(r['Pnp Worker Name']).trim();
      var key = workerKey(display);
      var sku = parseSku(r['Primary Sku']);
      var boxes = num(r['Boxes Packed']);
      var seconds = num(r['Packing Time Seconds']);
      var sh = shiftParts(r['Shift']);
      var line = {
        reportDate: r['Report Date'],
        shiftKey: sh.key,
        shiftLabel: sh.label,
        workerDisplay: display,
        workerKey: key,
        station: r['Station Name'],
        skuRaw: r['Primary Sku'],
        sku: sku,
        boxes: boxes,
        itemsPacked: num(r['Items Packed']),
        pouchesPacked: num(r['Pouches Packed']),
        packingSeconds: seconds,
        secondsPerItem: num(r['Seconds per Item']),
        pouchesPerHour: num(r['Pouches per Hour']),
        hours: null,
        actualBph: null,
        targetBph: null,
        strikeBph: null,
        targetBoxes: null,
        included: false,
        excludeReason: '',
        unknownSku: false
      };
      if (boxes == null) {
        exclusions.missing_boxes += 1;
        line.excludeReason = 'Missing Boxes Packed';
        raw.push(line);
        return;
      }
      if (seconds == null) {
        exclusions.missing_time += 1;
        line.excludeReason = 'Missing Packing Time Seconds';
        line.boxes = boxes;
        raw.push(line);
        return;
      }
      line.boxes = boxes;
      line.packingSeconds = seconds;
      line.hours = seconds / 3600;
      line.actualBph = line.hours > 0 ? boxes / line.hours : null;
      if (SKU_TARGETS[sku]) {
        line.targetBph = SKU_TARGETS[sku].target;
        line.strikeBph = SKU_TARGETS[sku].strike;
        line.targetBoxes = line.hours * line.targetBph;
      } else {
        line.unknownSku = true;
        exclusions.unknown_sku_lines += 1;
      }
      line.included = true;
      raw.push(line);
    });

    function lineVerdict(L) {
      if (!L.included) return 'excluded';
      if (L.unknownSku || L.targetBph == null) return 'no target';
      if (L.actualBph != null && L.strikeBph != null && L.actualBph < L.strikeBph) return 'under strike';
      if (L.actualBph != null && L.targetBph != null && L.actualBph < L.targetBph) return 'under target';
      return 'on/above target';
    }

    function skuWhyRows(wlines) {
      var rows = wlines.map(function (L) {
        var linePct = null;
        if (L.included && L.targetBoxes && L.targetBoxes > 0 && L.targetBph != null) {
          linePct = L.boxes / L.targetBoxes * 100;
        }
        return {
          sku: L.sku,
          hours: L.hours || 0,
          boxes: L.boxes || 0,
          actualBph: L.actualBph,
          targetBph: L.targetBph,
          strikeBph: L.strikeBph,
          targetBoxes: L.targetBoxes,
          linePct: linePct,
          verdict: lineVerdict(L)
        };
      });
      rows.sort(function (a, b) {
        var ae = a.verdict.indexOf('excluded') === 0 ? 2 : (a.linePct == null ? 1 : 0);
        var be = b.verdict.indexOf('excluded') === 0 ? 2 : (b.linePct == null ? 1 : 0);
        if (ae !== be) return ae - be;
        if (a.linePct != null && b.linePct != null && a.linePct !== b.linePct) return a.linePct - b.linePct;
        return String(a.sku).localeCompare(String(b.sku));
      });
      return rows;
    }

    function explainWhy(flag, pct, scoreBoxes, targetBoxes, skuRows, strikeBoxes) {
      var gap = targetBoxes != null ? scoreBoxes - targetBoxes : null;
      var strikeGap = strikeBoxes != null ? scoreBoxes - strikeBoxes : null;
      var bits = [];
      if (flag === 'No target defined') {
        bits.push('Cannot score % of target — no SKU on this shift has a target in the table.');
      } else if (flag === 'Below strike' && pct != null && strikeGap != null) {
        bits.push(
          'Overall below strike — short by ' + Math.abs(strikeGap).toFixed(0) +
          ' boxes vs hours × strike lines (' + pct.toFixed(0) + '% of target).'
        );
      } else if (flag === 'Below target' && pct != null && gap != null) {
        bits.push(
          'Above strike overall, but finished at ' + pct.toFixed(0) +
          '% of target — short by ' + Math.abs(gap).toFixed(0) + ' boxes for the hours worked.'
        );
      } else if (flag === 'On/above target' && pct != null && gap != null) {
        bits.push('Hit target at ' + pct.toFixed(0) + '% — ' + gap.toFixed(0) + ' boxes above what hours × SKU targets required.');
        var weak = skuRows.filter(function (r) { return r.verdict === 'under strike'; }).map(function (r) { return r.sku; });
        if (weak.length) {
          bits.push(
            'Some SKU lines under strike (' + weak.join(', ') +
            ') but the average still clears strike and target.'
          );
        }
      }
      var under = skuRows.filter(function (r) { return r.verdict === 'under strike' || r.verdict === 'under target'; });
      var strong = skuRows.filter(function (r) { return r.verdict === 'on/above target'; });
      if (under.length) {
        bits.push('Dragged by: ' + under.filter(function (r) { return r.actualBph != null && r.targetBph != null; }).map(function (r) {
          return 'SKU ' + r.sku + ' ' + r.actualBph.toFixed(1) + ' BPH vs target ' + r.targetBph +
            (r.verdict === 'under strike' ? ' / strike ' + r.strikeBph : '');
        }).join('; '));
      }
      if (strong.length && flag !== 'Below strike') {
        bits.push('Held up by: ' + strong.filter(function (r) { return r.actualBph != null && r.targetBph != null; }).map(function (r) {
          return 'SKU ' + r.sku + ' ' + r.actualBph.toFixed(1) + ' BPH (target ' + r.targetBph + ')';
        }).join('; '));
      }
      var excluded = skuRows.filter(function (r) { return r.verdict.indexOf('excluded') === 0; });
      if (excluded.length) {
        bits.push(excluded.length + ' incomplete SKU line(s) left out (missing boxes or packing time).');
      }
      return bits.join(' ');
    }

    function buildSkuMix(includedLines) {
      var bySku = {};
      (includedLines || []).forEach(function (L) {
        var skuKey = String(L.sku);
        if (!bySku[skuKey]) {
          bySku[skuKey] = { sku: L.sku, hours: 0, boxes: 0, unknownSku: !!L.unknownSku };
        }
        bySku[skuKey].hours += L.hours || 0;
        bySku[skuKey].boxes += L.boxes || 0;
        if (L.unknownSku) bySku[skuKey].unknownSku = true;
      });
      var totalHours = 0;
      var totalBoxes = 0;
      Object.keys(bySku).forEach(function (k) {
        totalHours += bySku[k].hours;
        totalBoxes += bySku[k].boxes;
      });
      var parts = Object.keys(bySku).map(function (k) { return bySku[k]; });
      parts.sort(function (a, b) {
        if (b.hours !== a.hours) return b.hours - a.hours;
        return String(a.sku).localeCompare(String(b.sku));
      });
      parts.forEach(function (p) {
        p.hoursShare = totalHours > 0 ? p.hours / totalHours * 100 : null;
        p.boxesShare = totalBoxes > 0 ? p.boxes / totalBoxes * 100 : null;
      });
      var labels = parts.map(function (p) { return String(p.sku); });
      return {
        count: parts.length,
        isMixed: parts.length > 1,
        label: labels.join(' · ') || '—',
        summary: parts.length > 1
          ? ('Mixed (' + parts.length + '): ' + labels.join(' · '))
          : (labels[0] ? ('SKU ' + labels[0]) : '—'),
        parts: parts,
        totalHours: totalHours,
        totalBoxes: totalBoxes
      };
    }

    function aggregate(shiftKey) {
      var by = {};
      raw.forEach(function (L) {
        if (L.shiftKey !== shiftKey) return;
        if (!by[L.workerKey]) by[L.workerKey] = [];
        by[L.workerKey].push(L);
      });
      var results = [];
      Object.keys(by).forEach(function (key) {
        var wlines = by[key];
        var included = wlines.filter(function (L) { return L.included; });
        if (!included.length) return;
        var hours = included.reduce(function (s, L) { return s + L.hours; }, 0);
        var boxes = included.reduce(function (s, L) { return s + L.boxes; }, 0);
        var known = included.filter(function (L) { return L.targetBph != null; });
        var hasUnknown = included.some(function (L) { return L.unknownSku; });
        var display = included[0].workerDisplay;
        var skuRows = skuWhyRows(wlines);
        var skuMix = buildSkuMix(included);
        var shortN = wlines.filter(function (L) { return !L.included; }).length;
        var hLines = hourLinesFor(key, shiftKey, hourLinesAll);
        var intraBoxesSum = hLines.reduce(function (s, h) { return s + (h.boxes || 0); }, 0);
        if (!known.length) {
          var skus = [];
          included.forEach(function (L) {
            if (L.unknownSku) skus.push(String(L.sku));
          });
          var shNone = resolveShiftHours(key, shiftKey);
          results.push({
            shiftKey: shiftKey,
            shiftLabel: included[0].shiftLabel,
            workerDisplay: display,
            workerKey: key,
            hours: hours,
            shiftHours: shNone.shiftHours,
            shiftHoursSource: shNone.shiftHoursSource,
            intraHours: shNone.intraHours != null ? shNone.intraHours : (hLines.length || null),
            intraBoxes: hLines.length ? intraBoxesSum : null,
            breakMinutes: shNone.breakMinutes || 0,
            boxes: boxes,
            targetBoxes: 0,
            pctOfTarget: null,
            flag: 'No target defined',
            notes: skus.length ? ('no target defined for SKU ' + skus.join(', ')) : '',
            why: explainWhy('No target defined', null, 0, 0, skuRows, 0),
            boxGap: null,
            strikeBoxes: 0,
            pctOfStrike: null,
            hoursBasis: null,
            skuLines: skuRows,
            skuMix: skuMix,
            rawLines: wlines,
            rawDataSegments: rawDataByWorker[key] || [],
            hourLines: hLines,
            excludedShortLines: shortN
          });
          return;
        }
        var intraH = intraHoursMap[key + '|' + shiftKey] || 0;
        var breakMins = autoBreakMinutes(intraH);
        var mapBrk = breakMinutesMap[key + '|' + shiftKey];
        if (mapBrk != null && isFinite(mapBrk) && mapBrk > breakMins) breakMins = mapBrk;
        var need = needBoxesFromHours(known, hours, intraH, breakMins);
        var targetBoxes = need.targetBoxes;
        var strikeBoxes = need.strikeBoxes;
        var boxesKnown = known.reduce(function (s, L) { return s + L.boxes; }, 0);
        var pct = targetBoxes > 0 ? (boxesKnown / targetBoxes * 100) : null;
        var pctStrike = strikeBoxes > 0 ? (boxesKnown / strikeBoxes * 100) : null;
        // Packer flag uses overall average vs strike/target — a weak SKU line
        // does not force Below strike if hours×strike still clears.
        // When Intra hours exist, need boxes use Intra − auto breaks (15m >4h, +30m >6h).
        var flag;
        if (pct == null) flag = 'No target defined';
        else if (strikeBoxes > 0 && boxesKnown < strikeBoxes) flag = 'Below strike';
        else if (pct < 100) flag = 'Below target';
        else flag = 'On/above target';
        var notes = '';
        if (hasUnknown) {
          var u = [];
          included.forEach(function (L) { if (L.unknownSku) u.push(String(L.sku)); });
          notes = 'no target defined for SKU ' + u.join(', ');
        }
        var shInfo = resolveShiftHours(key, shiftKey);
        results.push({
          shiftKey: shiftKey,
          shiftLabel: included[0].shiftLabel,
          workerDisplay: display,
          workerKey: key,
          hours: hours,
          shiftHours: shInfo.shiftHours,
          shiftHoursSource: shInfo.shiftHoursSource,
          intraHours: need.intraHours != null ? need.intraHours : (shInfo.intraHours != null ? shInfo.intraHours : (hLines.length || null)),
          intraBoxes: hLines.length ? intraBoxesSum : null,
          breakMinutes: need.breakMinutes || shInfo.breakMinutes || 0,
          boxes: boxes,
          targetBoxes: targetBoxes,
          strikeBoxes: strikeBoxes,
          pctOfTarget: pct,
          pctOfStrike: pctStrike,
          flag: flag,
          notes: notes,
          why: explainWhy(flag, pct, boxesKnown, targetBoxes, skuRows, strikeBoxes),
          boxGap: targetBoxes ? boxesKnown - targetBoxes : null,
          hoursBasis: need.hoursBasis,
          skuLines: skuRows,
          skuMix: skuMix,
          rawLines: wlines,
          rawDataSegments: rawDataByWorker[key] || [],
          hourLines: hLines,
          excludedShortLines: shortN
        });
      });
      results.sort(function (a, b) {
        if (a.pctOfTarget == null && b.pctOfTarget == null) return a.workerDisplay.localeCompare(b.workerDisplay);
        if (a.pctOfTarget == null) return 1;
        if (b.pctOfTarget == null) return -1;
        if (a.pctOfTarget !== b.pctOfTarget) return a.pctOfTarget - b.pctOfTarget;
        return a.workerDisplay.localeCompare(b.workerDisplay);
      });
      return results;
    }

    function totalsFor(results, shiftKey, shiftLabel) {
      var hours = results.reduce(function (s, r) { return s + r.hours; }, 0);
      var boxes = results.reduce(function (s, r) { return s + r.boxes; }, 0);
      var target = results.reduce(function (s, r) { return s + r.targetBoxes; }, 0);
      var intraHours = results.reduce(function (s, r) {
        if (r.intraHours != null && isFinite(r.intraHours)) return s + r.intraHours;
        return s + ((r.hourLines && r.hourLines.length) || 0);
      }, 0);
      var intraBoxes = results.reduce(function (s, r) {
        return s + (r.intraBoxes != null ? r.intraBoxes : 0);
      }, 0);
      var score = 0;
      results.forEach(function (r) {
        if (r.pctOfTarget != null && r.targetBoxes) score += r.targetBoxes * r.pctOfTarget / 100;
      });
      return {
        shiftKey: shiftKey,
        shiftLabel: shiftLabel,
        packers: results.length,
        hours: hours,
        intraHours: intraHours,
        intraBoxes: intraBoxes,
        boxes: boxes,
        targetBoxes: target,
        pctOfTarget: target > 0 ? score / target * 100 : null,
        boxGap: target > 0 ? score - target : null,
        below: results.filter(function (r) { return r.flag === 'Below strike'; }).length,
        dipped: results.filter(function (r) { return r.flag === 'Below target'; }).length,
        onTarget: results.filter(function (r) { return r.flag === 'On/above target'; }).length,
        noTarget: results.filter(function (r) { return r.flag === 'No target defined'; }).length
      };
    }

    var morning = aggregate('morning_shift');
    var afternoon = aggregate('afternoon_shift');
    var workerSet = {};
    raw.forEach(function (L) { workerSet[L.workerDisplay] = true; });

    return {
      rawLines: raw,
      morning: morning,
      afternoon: afternoon,
      morningTotals: totalsFor(morning, 'morning_shift', 'Morning'),
      afternoonTotals: totalsFor(afternoon, 'afternoon_shift', 'Afternoon'),
      exclusions: exclusions,
      facilityWorkers: Object.keys(workerSet).sort(),
      intraRows: intraRows || [],
      hourLines: hourLinesAll,
      byHour: buildByHour(hourLinesAll, morning, afternoon),
      rawDataRows: rawDataAll,
      rawDataMixed: rawDataMixed,
      execSummaryRows: execAll,
      warnings: warnings,
      skuTargets: SKU_TARGETS,
      facilityName: FACILITY_NAME,
      breakMinutesByWorkerShift: breakMinutesMap
    };
  }

  function readWorkbookArrayBuffer(buf, fileLabel, required) {
    var X = rootXLSX();
    var wb = X.read(buf, { type: 'array', cellDates: true });
    return sheetToRows(wb, fileLabel, required);
  }

  async function fileToArrayBuffer(file) {
    return await file.arrayBuffer();
  }

  async function fileToText(file) {
    return await file.text();
  }

  async function loadRawDataFile(rawFile) {
    if (!rawFile) return { rows: [], droppedFacility: 0, droppedBlank: 0 };
    var name = rawFile.name || 'Raw_Data.csv';
    var lower = name.toLowerCase();
    var sheetRows;
    if (lower.indexOf('.csv') !== -1) {
      var text = await fileToText(rawFile);
      sheetRows = csvTextToSheetRows(text, name, RAW_DATA_COLS);
    } else {
      var buf = await fileToArrayBuffer(rawFile);
      sheetRows = readWorkbookArrayBuffer(buf, name, RAW_DATA_COLS);
    }
    return loadRawDataRows(sheetRows);
  }

  async function loadExecutiveSummaryFile(execFile) {
    if (!execFile) {
      return { rows: [], droppedFacility: 0, droppedBlank: 0, facilityFiltered: false };
    }
    var name = execFile.name || 'Executive_Summary.csv';
    var lower = name.toLowerCase();
    var sheetRows;
    if (lower.indexOf('.csv') !== -1) {
      var text = await fileToText(execFile);
      sheetRows = csvTextToSheetRows(text, name, EXEC_SUMMARY_COLS);
    } else {
      var buf = await fileToArrayBuffer(execFile);
      sheetRows = readWorkbookArrayBuffer(buf, name, EXEC_SUMMARY_COLS);
    }
    return loadExecutiveSummaryRows(sheetRows);
  }

  async function buildReportFromFiles(boxesFile, intraFile, rawFile, execFile, breakMinutesByWorkerShiftMap) {
    var boxesAoA = await fileToArrayBuffer(boxesFile);
    var boxesSheetRows = readWorkbookArrayBuffer(boxesAoA, boxesFile.name || 'Boxes_Packed_by_Worker.xlsx', BOXES_COLS);
    var boxesParsed = loadBoxesRows(boxesSheetRows);
    var intraBuf = await fileToArrayBuffer(intraFile);
    var intraRows = loadIntraRows(
      readWorkbookArrayBuffer(intraBuf, intraFile.name || 'Intra_Hour_Floor_Performance.xlsx', INTRA_COLS)
    );
    var rawParsed = await loadRawDataFile(rawFile || null);
    var execParsed = await loadExecutiveSummaryFile(execFile || null);
    var report = buildReport(
      boxesParsed.rows,
      boxesParsed.droppedBlank,
      intraRows,
      rawParsed.rows,
      execParsed.rows,
      breakMinutesByWorkerShiftMap || {}
    );
    report.rawDataMeta = {
      droppedFacility: rawParsed.droppedFacility,
      droppedBlank: rawParsed.droppedBlank,
      fileName: rawFile ? (rawFile.name || '') : ''
    };
    report.execSummaryMeta = {
      droppedFacility: execParsed.droppedFacility,
      droppedBlank: execParsed.droppedBlank,
      facilityFiltered: execParsed.facilityFiltered,
      fileName: execFile ? (execFile.name || '') : '',
      workers: (execParsed.rows || []).length
    };
    return report;
  }

  function sheetFromAoA(aoa) {
    var X = rootXLSX();
    return X.utils.aoa_to_sheet(aoa);
  }

  function appendSheet(wb, name, aoa) {
    var X = rootXLSX();
    X.utils.book_append_sheet(wb, sheetFromAoA(aoa), name);
  }

  function shiftSheetAoA(rows, totals) {
    var aoa = [
      ['Shift amount', totals ? totals.shiftLabel : ''],
      ['Packers', totals ? totals.packers : 0],
      ['Hours all up (Pack h)', totals ? Number(totals.hours.toFixed(2)) : 0],
      ['Intra hours all up', totals && totals.intraHours != null ? Number(totals.intraHours.toFixed(2)) : 0],
      ['Boxes packed', totals ? Math.round(totals.boxes) : 0],
      ['Target boxes', totals ? Number(totals.targetBoxes.toFixed(1)) : 0],
      ['% of target', totals && totals.pctOfTarget != null ? Number(totals.pctOfTarget.toFixed(1)) : ''],
      ['Gap (boxes)', totals && totals.boxGap != null ? Math.round(totals.boxGap) : ''],
      [],
      ['Packer', 'SKU mix', 'Mixed?', 'Pack hours', 'Shift hours', 'Intra hours', 'Break mins',
        'Boxes (file)', 'Intra boxes', 'Target boxes', '% of target', 'Gap', 'Flag', 'Why']
    ];
    (rows || []).forEach(function (r) {
      aoa.push([
        r.workerDisplay,
        r.skuMix ? r.skuMix.label : '',
        r.skuMix && r.skuMix.isMixed ? 'Yes' : 'No',
        r.hours != null ? Number(r.hours.toFixed(2)) : '',
        r.shiftHours != null ? Number(r.shiftHours.toFixed(2)) : '',
        r.intraHours != null ? Number(r.intraHours.toFixed(2)) : '',
        r.breakMinutes != null ? Math.round(r.breakMinutes) : '',
        r.boxes != null ? Math.round(r.boxes) : '',
        r.intraBoxes != null ? Math.round(r.intraBoxes) : '',
        r.targetBoxes != null ? Number(r.targetBoxes.toFixed(1)) : '',
        r.pctOfTarget != null ? Number(r.pctOfTarget.toFixed(1)) : '',
        r.boxGap != null ? Math.round(r.boxGap) : '',
        r.flag || '',
        r.why || ''
      ]);
    });
    return aoa;
  }

  function skuDetailAoA(morning, afternoon) {
    var aoa = [[
      'Shift', 'Packer', 'SKU', 'Hours', 'Boxes', 'Actual BPH', 'Target BPH', 'Strike BPH',
      'Line %', 'Verdict', 'SKU mix', 'Mixed?', 'Packer % of target', 'Packer flag'
    ]];
    function addShift(rows) {
      (rows || []).forEach(function (r) {
        var lines = r.skuLines || [];
        var totH = 0;
        var totB = 0;
        var knownH = 0;
        var knownTB = 0;
        var strikeH = 0;
        var strikeW = 0;
        lines.forEach(function (L) {
          if (L.verdict && String(L.verdict).indexOf('excluded') === 0) return;
          totH += L.hours || 0;
          totB += L.boxes || 0;
          if (L.targetBph != null && L.hours != null) {
            knownH += L.hours;
            knownTB += L.hours * L.targetBph;
          }
          if (L.strikeBph != null && L.hours != null) {
            strikeH += L.hours;
            strikeW += L.hours * L.strikeBph;
          }
          aoa.push([
            r.shiftLabel,
            r.workerDisplay,
            L.sku,
            L.hours != null ? Number(L.hours.toFixed(2)) : '',
            L.boxes != null ? Math.round(L.boxes) : '',
            L.actualBph != null ? Number(L.actualBph.toFixed(1)) : '',
            L.targetBph != null ? L.targetBph : '',
            L.strikeBph != null ? L.strikeBph : '',
            L.linePct != null ? Number(L.linePct.toFixed(0)) : '',
            L.verdict || '',
            r.skuMix ? r.skuMix.label : '',
            r.skuMix && r.skuMix.isMixed ? 'Yes' : 'No',
            r.pctOfTarget != null ? Number(r.pctOfTarget.toFixed(1)) : '',
            r.flag || ''
          ]);
        });
        aoa.push([
          r.shiftLabel,
          r.workerDisplay,
          'Total / avg',
          Number(totH.toFixed(2)),
          Math.round(totB),
          totH > 0 ? Number((totB / totH).toFixed(1)) : '',
          knownH > 0 ? Number((knownTB / knownH).toFixed(1)) : '',
          strikeH > 0 ? Number((strikeW / strikeH).toFixed(1)) : '',
          r.pctOfTarget != null ? Number(r.pctOfTarget.toFixed(0)) : '',
          r.flag || '',
          r.skuMix ? r.skuMix.label : '',
          r.skuMix && r.skuMix.isMixed ? 'Yes' : 'No',
          r.pctOfTarget != null ? Number(r.pctOfTarget.toFixed(1)) : '',
          r.flag || ''
        ]);
      });
    }
    addShift(morning);
    addShift(afternoon);
    return aoa;
  }

  function byHourAoA(byHour) {
    var aoa = [[
      'Hour', 'Shift', 'Packer', 'Intra boxes this hour',
      'Boxes file (shift)', 'Pack h', 'Intra h', 'Target boxes', '% of target', 'Flag',
      'SKU mix (Boxes)', 'Mixed?'
    ]];
    (byHour || []).forEach(function (H) {
      (H.packers || []).forEach(function (p) {
        var mix = p.skuInfo && p.skuInfo.mix;
        var bs = p.boxesScore || {};
        aoa.push([
          H.hourLabel,
          H.shiftLabel,
          p.workerDisplay,
          Math.round(p.boxes),
          bs.boxesFile != null ? Math.round(bs.boxesFile) : '',
          bs.packHours != null ? Number(bs.packHours.toFixed(2)) : '',
          bs.intraHours != null ? Number(bs.intraHours.toFixed(2)) : '',
          bs.targetBoxes != null ? Number(bs.targetBoxes.toFixed(1)) : '',
          bs.pctOfTarget != null ? Number(bs.pctOfTarget.toFixed(1)) : '',
          bs.flag || '',
          mix ? mix.label : '',
          mix && mix.isMixed ? 'Yes' : 'No'
        ]);
      });
    });
    return aoa;
  }

  function rawDataAoA(rawLines) {
    var aoa = [[
      'Report Date', 'Shift', 'Worker Name', 'Station', 'Primary Sku (raw)', 'Primary Sku',
      'Boxes Packed', 'Items Packed', 'Pouches Packed', 'Packing Time Seconds',
      'Seconds per Item', 'Pouches per Hour', 'Hours on SKU', 'Actual BPH',
      'Target BPH', 'Strike BPH', 'Target boxes', 'Included', 'Unknown SKU', 'Note'
    ]];
    (rawLines || []).forEach(function (L) {
      aoa.push([
        L.reportDate,
        L.shiftLabel,
        L.workerDisplay,
        L.station,
        L.skuRaw != null ? L.skuRaw : '',
        L.sku,
        L.boxes != null ? L.boxes : '',
        L.itemsPacked != null ? L.itemsPacked : '',
        L.pouchesPacked != null ? L.pouchesPacked : '',
        L.packingSeconds != null ? L.packingSeconds : '',
        L.secondsPerItem != null ? L.secondsPerItem : '',
        L.pouchesPerHour != null ? L.pouchesPerHour : '',
        L.hours != null ? Number(L.hours.toFixed(4)) : '',
        L.actualBph != null ? Number(L.actualBph.toFixed(2)) : '',
        L.targetBph != null ? L.targetBph : '',
        L.strikeBph != null ? L.strikeBph : '',
        L.targetBoxes != null ? Number(L.targetBoxes.toFixed(2)) : '',
        L.included ? 1 : 0,
        L.unknownSku ? 1 : 0,
        L.excludeReason || (L.unknownSku ? ('no target for SKU ' + L.sku) : '')
      ]);
    });
    return aoa;
  }

  function facilityRawMixedAoA(rawDataMixed) {
    var aoa = [[
      'Packer', 'Mixed segments', 'Hours (raw segments)', 'Boxes (raw segments)',
      'SKU mix (from Box Sku Sizes)', 'Segment Box Sku Sizes', 'Segment boxes',
      'Segment packing sec', 'Segment hours', 'Segment BPH', 'First Scan', 'Last Scan'
    ]];
    (rawDataMixed || []).forEach(function (w) {
      (w.segments || []).forEach(function (seg, i) {
        aoa.push([
          i === 0 ? w.workerDisplay : '',
          i === 0 ? w.segmentCount : '',
          i === 0 ? Number(w.hours.toFixed(2)) : '',
          i === 0 ? Math.round(w.boxes) : '',
          i === 0 ? w.mixLabel : '',
          seg.boxSkuSizes,
          seg.boxes != null ? seg.boxes : '',
          seg.packingSeconds != null ? seg.packingSeconds : '',
          seg.hours != null ? Number(seg.hours.toFixed(3)) : '',
          seg.actualBph != null ? Number(seg.actualBph.toFixed(2)) : '',
          seg.firstScan,
          seg.lastScan
        ]);
      });
    });
    return aoa;
  }

  function rawDataAllAoA(rawDataRows) {
    var aoa = [[
      'Report Date', 'Facility', 'Packer', 'Mixed?', 'Box Sku Sizes', 'SKUs',
      'Boxes', 'Packing Seconds', 'Hours', 'BPH', 'First Scan', 'Last Scan', 'Shift guess'
    ]];
    (rawDataRows || []).forEach(function (r) {
      aoa.push([
        r.reportDate,
        r.facilityName,
        r.workerDisplay,
        r.isMixed ? 'Yes' : 'No',
        r.boxSkuSizes,
        (r.skus || []).join(' · '),
        r.boxes != null ? r.boxes : '',
        r.packingSeconds != null ? r.packingSeconds : '',
        r.hours != null ? Number(r.hours.toFixed(4)) : '',
        r.actualBph != null ? Number(r.actualBph.toFixed(2)) : '',
        r.firstScan,
        r.lastScan,
        r.shiftLabel
      ]);
    });
    return aoa;
  }

  /** Build a downloadable xlsx workbook object from a built report. */
  function buildExportWorkbook(report) {
    var X = rootXLSX();
    if (!X || !X.utils) throw new Error('SheetJS XLSX not available for export');
    var wb = X.utils.book_new();
    var mt = report.morningTotals || {};
    var at = report.afternoonTotals || {};
    var mixedList = Array.isArray(report.rawDataMixed) ? report.rawDataMixed : [];
    var mixedBoxes = mixedList.reduce(function (s, w) { return s + (w.boxes || 0); }, 0);
    appendSheet(wb, 'Summary', [
      ['Packer shift report', FACILITY_NAME],
      ['Generated', new Date().toISOString()],
      [],
      ['Morning packers', mt.packers || 0],
      ['Morning hours all up', mt.hours != null ? Number(mt.hours.toFixed(2)) : 0],
      ['Morning boxes', mt.boxes != null ? Math.round(mt.boxes) : 0],
      ['Morning % of target', mt.pctOfTarget != null ? Number(mt.pctOfTarget.toFixed(1)) : ''],
      [],
      ['Afternoon packers', at.packers || 0],
      ['Afternoon hours all up', at.hours != null ? Number(at.hours.toFixed(2)) : 0],
      ['Afternoon boxes', at.boxes != null ? Math.round(at.boxes) : 0],
      ['Afternoon % of target', at.pctOfTarget != null ? Number(at.pctOfTarget.toFixed(1)) : ''],
      [],
      ['Raw Data mixed workers', mixedList.length],
      ['Raw Data mixed boxes', Math.round(mixedBoxes)],
      [],
      ['Notes'],
      ['Boxes Packed by Worker supplies SKUs + boxes. Pack h = packing time.'],
      ['Intra Hour clock hours are summed as shift length for strike/target need when present.'],
      ['Tea (~15m) + Meal (~30m) from Breaks planner are subtracted from that Intra length when the packer is on a break group.'],
      ['Need boxes = (Intra − breaks) × SKU targets (shared by packing-time weight). Without Intra, Pack h is used.'],
      ['Sizes from Raw Data (Box Sku Sizes) appear on packer detail — not a separate score.']
    ]);
    appendSheet(wb, 'Morning shift', shiftSheetAoA(report.morning, report.morningTotals));
    appendSheet(wb, 'Afternoon shift', shiftSheetAoA(report.afternoon, report.afternoonTotals));
    appendSheet(wb, 'SKU detail', skuDetailAoA(report.morning, report.afternoon));
    appendSheet(wb, 'Sizes (Raw Data)', facilityRawMixedAoA(report.rawDataMixed));
    appendSheet(wb, 'Raw Data export', rawDataAllAoA(report.rawDataRows));
    appendSheet(wb, 'Boxes raw lines', rawDataAoA(report.rawLines));
    appendSheet(wb, 'By hour', byHourAoA(report.byHour));
    var ex = report.exclusions || {};
    appendSheet(wb, 'Exclusions', [
      ['Reason', 'Count'],
      ['Blank worker name or Primary Sku', ex.blank_worker_or_sku || 0],
      ['Missing Boxes Packed', ex.missing_boxes || 0],
      ['Missing Packing Time Seconds', ex.missing_time || 0],
      ['Unknown SKU lines (kept & flagged)', ex.unknown_sku_lines || 0]
    ]);
    var skuAoa = [['Primary Sku', 'Target BPH', 'Strike line BPH']];
    Object.keys(SKU_TARGETS).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sku) {
      skuAoa.push([sku, SKU_TARGETS[sku].target, SKU_TARGETS[sku].strike]);
    });
    appendSheet(wb, 'SKU targets', skuAoa);
    return wb;
  }

  function workbookToArrayBuffer(wb) {
    var X = rootXLSX();
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  return {
    SKU_TARGETS: SKU_TARGETS,
    FACILITY_NAME: FACILITY_NAME,
    BOXES_COLS: BOXES_COLS,
    INTRA_COLS: INTRA_COLS,
    RAW_DATA_COLS: RAW_DATA_COLS,
    EXEC_SUMMARY_COLS: EXEC_SUMMARY_COLS,
    validateHeaders: validateHeaders,
    parseBoxSkuSizes: parseBoxSkuSizes,
    loadRawDataRows: loadRawDataRows,
    loadExecutiveSummaryRows: loadExecutiveSummaryRows,
    csvTextToSheetRows: csvTextToSheetRows,
    needBoxesFromHours: needBoxesFromHours,
    intraHoursByWorkerShift: intraHoursByWorkerShift,
    autoBreakMinutes: autoBreakMinutes,
    breakMinutesForGroup: breakMinutesForGroup,
    minutesBetweenHm: minutesBetweenHm,
    breakMinutesByWorkerShift: breakMinutesByWorkerShift,
    breakMinutesLookupFromStorage: breakMinutesLookupFromStorage,
    summarizePackerTotalAvg: summarizePackerTotalAvg,
    buildReport: buildReport,
    buildReportFromFiles: buildReportFromFiles,
    buildExportWorkbook: buildExportWorkbook,
    workbookToArrayBuffer: workbookToArrayBuffer,
    loadBoxesRows: loadBoxesRows,
    readWorkbookArrayBuffer: readWorkbookArrayBuffer
  };
});
