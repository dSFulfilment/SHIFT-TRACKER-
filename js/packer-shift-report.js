/**
 * Dandenong South packer shift performance-vs-target (browser + Node).
 * Mirrors packer_shift_report/ Python rules. Facility summary BPH is never used for scoring.
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
  var MIN_HOURS = 0.25;

  var BOXES_COLS = [
    'Report Date', 'Shift', 'Pnp Worker Name', 'Station Name', 'Primary Sku',
    'Boxes Packed', 'Items Packed', 'Pouches Packed', 'Packing Time Seconds',
    'Seconds per Item', 'Pouches per Hour'
  ];
  var INTRA_COLS = ['Report Date Hour', 'Pnp Worker Name', 'Boxes Packed'];
  var SUMMARY_COLS = [
    'Report Date', 'Facility Name', 'Pnp Worker Name', 'Idle Time %',
    'Total Boxes Packed', 'Packing Time (Hours)', 'Boxes per Hour'
  ];

  function normHeader(h) {
    return String(h == null ? '' : h).trim().replace(/\s+/g, ' ');
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
    var found = headers.map(normHeader).filter(function (h, i, arr) {
      // keep empties in the middle; trim trailing empties only
      return true;
    });
    while (found.length && found[found.length - 1] === '') found.pop();
    var set = {};
    found.forEach(function (h) { set[h] = true; });
    var missing = required.filter(function (c) { return !set[c]; });
    if (missing.length) {
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
    return found;
  }

  function sheetToRows(workbook, fileLabel, required) {
    var sheetName = workbook.SheetNames[0];
    var sheet = workbook.Sheets[sheetName];
    var aoa = rootXLSX().utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    if (!aoa.length) {
      validateHeaders(fileLabel, [], required);
      return [];
    }
    var headers = validateHeaders(fileLabel, aoa[0], required);
    var rows = [];
    for (var r = 1; r < aoa.length; r++) {
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
    var X = (typeof XLSX !== 'undefined') ? XLSX : (typeof window !== 'undefined' ? window.XLSX : null);
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

  function facilityWorkers(summaryRows) {
    var map = {};
    summaryRows.forEach(function (d) {
      if (String(d['Facility Name'] == null ? '' : d['Facility Name']).trim() !== FACILITY_NAME) return;
      var display = String(d['Pnp Worker Name']).trim();
      var key = workerKey(display);
      if (key && !map[key]) map[key] = display;
    });
    return map;
  }

  function buildReport(boxesRows, summaryRows, boxesDroppedBlank, intraRows) {
    var exclusions = {
      blank_worker_or_sku: boxesDroppedBlank || 0,
      missing_boxes: 0,
      missing_time: 0,
      under_15_min: 0,
      not_dandenong_south: 0,
      unknown_sku_lines: 0
    };
    var facility = facilityWorkers(summaryRows || []);
    var warnings = [];
    if (!Object.keys(facility).length) {
      warnings.push('No workers found with Facility Name == "' + FACILITY_NAME + '" in the summary file.');
    }

    var raw = [];
    (boxesRows || []).forEach(function (r) {
      var display = String(r['Pnp Worker Name']).trim();
      var key = workerKey(display);
      if (!facility[key]) {
        exclusions.not_dandenong_south += 1;
        return;
      }
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
        sku: sku,
        boxes: boxes,
        packingSeconds: seconds,
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
      if (line.hours < MIN_HOURS) {
        line.included = false;
        line.excludeReason = 'Under 15-minute filter';
        exclusions.under_15_min += 1;
      } else {
        line.included = true;
      }
      raw.push(line);
    });

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
        if (!known.length) {
          var skus = [];
          included.forEach(function (L) {
            if (L.unknownSku) skus.push(String(L.sku));
          });
          results.push({
            shiftKey: shiftKey,
            shiftLabel: included[0].shiftLabel,
            workerDisplay: display,
            hours: hours,
            boxes: boxes,
            targetBoxes: 0,
            pctOfTarget: null,
            flag: 'No target defined',
            notes: skus.length ? ('no target defined for SKU ' + skus.join(', ')) : ''
          });
          return;
        }
        var targetBoxes = known.reduce(function (s, L) { return s + L.hours * L.targetBph; }, 0);
        var boxesKnown = known.reduce(function (s, L) { return s + L.boxes; }, 0);
        var pct = targetBoxes > 0 ? (boxesKnown / targetBoxes * 100) : null;
        var dipped = known.some(function (L) {
          return L.actualBph != null && L.strikeBph != null && L.actualBph < L.strikeBph;
        });
        var flag;
        if (pct == null) flag = 'No target defined';
        else if (pct < 100) flag = 'Below target';
        else if (dipped) flag = 'Dipped below strike';
        else flag = 'On/above target';
        var notes = '';
        if (hasUnknown) {
          var u = [];
          included.forEach(function (L) { if (L.unknownSku) u.push(String(L.sku)); });
          notes = 'no target defined for SKU ' + u.join(', ');
        }
        results.push({
          shiftKey: shiftKey,
          shiftLabel: included[0].shiftLabel,
          workerDisplay: display,
          hours: hours,
          boxes: boxes,
          targetBoxes: targetBoxes,
          pctOfTarget: pct,
          flag: flag,
          notes: notes
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

    return {
      rawLines: raw,
      morning: aggregate('morning_shift'),
      afternoon: aggregate('afternoon_shift'),
      exclusions: exclusions,
      facilityWorkers: Object.keys(facility).map(function (k) { return facility[k]; }).sort(),
      intraRows: intraRows || [],
      warnings: warnings,
      skuTargets: SKU_TARGETS,
      facilityName: FACILITY_NAME,
      minHours: MIN_HOURS
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

  async function buildReportFromFiles(boxesFile, summaryFile, intraFile) {
    var boxesAoA = await fileToArrayBuffer(boxesFile);
    var summaryAoA = await fileToArrayBuffer(summaryFile);
    var boxesSheetRows = readWorkbookArrayBuffer(boxesAoA, boxesFile.name || 'Boxes_Packed_by_Worker.xlsx', BOXES_COLS);
    var summarySheetRows = readWorkbookArrayBuffer(summaryAoA, summaryFile.name || 'Overall_Summary_by_Packer_and_Date.xlsx', SUMMARY_COLS);
    var boxesParsed = loadBoxesRows(boxesSheetRows);
    var intraRows = [];
    if (intraFile) {
      var intraBuf = await fileToArrayBuffer(intraFile);
      intraRows = loadIntraRows(
        readWorkbookArrayBuffer(intraBuf, intraFile.name || 'Intra_Hour_Floor_Performance.xlsx', INTRA_COLS)
      );
    }
    return buildReport(boxesParsed.rows, summarySheetRows, boxesParsed.droppedBlank, intraRows);
  }

  return {
    SKU_TARGETS: SKU_TARGETS,
    FACILITY_NAME: FACILITY_NAME,
    MIN_HOURS: MIN_HOURS,
    BOXES_COLS: BOXES_COLS,
    INTRA_COLS: INTRA_COLS,
    SUMMARY_COLS: SUMMARY_COLS,
    validateHeaders: validateHeaders,
    buildReport: buildReport,
    buildReportFromFiles: buildReportFromFiles,
    loadBoxesRows: loadBoxesRows,
    readWorkbookArrayBuffer: readWorkbookArrayBuffer
  };
});
