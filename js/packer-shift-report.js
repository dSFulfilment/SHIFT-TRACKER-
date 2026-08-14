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
    'boxes per hour': 'Boxes per Hour'
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

  function buildByHour(hourLines, morning, afternoon) {
    var skuByWorkerShift = {};
    function index(rows) {
      (rows || []).forEach(function (r) {
        skuByWorkerShift[r.workerKey + '|' + r.shiftKey] = (r.skuLines || []).map(function (L) {
          return { sku: L.sku, boxes: L.boxes, hours: L.hours, verdict: L.verdict };
        });
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
      byHour[k].packers.push({
        workerDisplay: h.workerDisplay,
        workerKey: h.workerKey,
        boxes: h.boxes,
        skus: skuByWorkerShift[h.workerKey + '|' + h.shiftKey] || []
      });
    });
    return Object.keys(byHour).map(function (k) { return byHour[k]; }).sort(function (a, b) {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      return 0;
    });
  }

  function buildReport(boxesRows, boxesDroppedBlank, intraRows) {
    var exclusions = {
      blank_worker_or_sku: boxesDroppedBlank || 0,
      missing_boxes: 0,
      missing_time: 0,
      unknown_sku_lines: 0
    };
    var warnings = [];
    var hourLinesAll = normalizeIntraHours(intraRows);

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

    function explainWhy(flag, pct, scoreBoxes, targetBoxes, skuRows) {
      var gap = targetBoxes != null ? scoreBoxes - targetBoxes : null;
      var bits = [];
      if (flag === 'No target defined') {
        bits.push('Cannot score % of target — no SKU on this shift has a target in the table.');
      } else if (flag === 'Below target' && pct != null && gap != null) {
        bits.push('Finished at ' + pct.toFixed(0) + '% of target — short by ' + Math.abs(gap).toFixed(0) + ' boxes for the hours worked.');
      } else if (flag === 'Dipped below strike' && pct != null && gap != null) {
        var weak = skuRows.filter(function (r) { return r.verdict === 'under strike'; }).map(function (r) { return r.sku; });
        bits.push('Beat overall target (' + pct.toFixed(0) + '%, +' + gap.toFixed(0) + ' boxes) but dipped under the strike line on SKU ' + (weak.join(', ') || '?') + '.');
      } else if (flag === 'On/above target' && pct != null && gap != null) {
        bits.push('Hit target at ' + pct.toFixed(0) + '% — ' + gap.toFixed(0) + ' boxes above what hours × SKU targets required.');
      }
      var under = skuRows.filter(function (r) { return r.verdict === 'under strike' || r.verdict === 'under target'; });
      var strong = skuRows.filter(function (r) { return r.verdict === 'on/above target'; });
      if (under.length) {
        bits.push('Dragged by: ' + under.filter(function (r) { return r.actualBph != null && r.targetBph != null; }).map(function (r) {
          return 'SKU ' + r.sku + ' ' + r.actualBph.toFixed(1) + ' BPH vs target ' + r.targetBph +
            (r.verdict === 'under strike' ? ' / strike ' + r.strikeBph : '');
        }).join('; '));
      }
      if (strong.length && flag !== 'Below target') {
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
        var shortN = wlines.filter(function (L) { return !L.included; }).length;
        if (!known.length) {
          var skus = [];
          included.forEach(function (L) {
            if (L.unknownSku) skus.push(String(L.sku));
          });
          results.push({
            shiftKey: shiftKey,
            shiftLabel: included[0].shiftLabel,
            workerDisplay: display,
            workerKey: key,
            hours: hours,
            boxes: boxes,
            targetBoxes: 0,
            pctOfTarget: null,
            flag: 'No target defined',
            notes: skus.length ? ('no target defined for SKU ' + skus.join(', ')) : '',
            why: explainWhy('No target defined', null, 0, 0, skuRows),
            boxGap: null,
            skuLines: skuRows,
            hourLines: hourLinesFor(key, shiftKey, hourLinesAll),
            excludedShortLines: shortN
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
          workerKey: key,
          hours: hours,
          boxes: boxes,
          targetBoxes: targetBoxes,
          pctOfTarget: pct,
          flag: flag,
          notes: notes,
          why: explainWhy(flag, pct, boxesKnown, targetBoxes, skuRows),
          boxGap: targetBoxes ? boxesKnown - targetBoxes : null,
          skuLines: skuRows,
          hourLines: hourLinesFor(key, shiftKey, hourLinesAll),
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
      var score = 0;
      results.forEach(function (r) {
        if (r.pctOfTarget != null && r.targetBoxes) score += r.targetBoxes * r.pctOfTarget / 100;
      });
      return {
        shiftKey: shiftKey,
        shiftLabel: shiftLabel,
        packers: results.length,
        hours: hours,
        boxes: boxes,
        targetBoxes: target,
        pctOfTarget: target > 0 ? score / target * 100 : null,
        boxGap: target > 0 ? score - target : null,
        below: results.filter(function (r) { return r.flag === 'Below target'; }).length,
        dipped: results.filter(function (r) { return r.flag === 'Dipped below strike'; }).length,
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
      warnings: warnings,
      skuTargets: SKU_TARGETS,
      facilityName: FACILITY_NAME
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

  async function buildReportFromFiles(boxesFile, intraFile) {
    var boxesAoA = await fileToArrayBuffer(boxesFile);
    var boxesSheetRows = readWorkbookArrayBuffer(boxesAoA, boxesFile.name || 'Boxes_Packed_by_Worker.xlsx', BOXES_COLS);
    var boxesParsed = loadBoxesRows(boxesSheetRows);
    var intraBuf = await fileToArrayBuffer(intraFile);
    var intraRows = loadIntraRows(
      readWorkbookArrayBuffer(intraBuf, intraFile.name || 'Intra_Hour_Floor_Performance.xlsx', INTRA_COLS)
    );
    return buildReport(boxesParsed.rows, boxesParsed.droppedBlank, intraRows);
  }

  return {
    SKU_TARGETS: SKU_TARGETS,
    FACILITY_NAME: FACILITY_NAME,
    BOXES_COLS: BOXES_COLS,
    INTRA_COLS: INTRA_COLS,
    validateHeaders: validateHeaders,
    buildReport: buildReport,
    buildReportFromFiles: buildReportFromFiles,
    loadBoxesRows: loadBoxesRows,
    readWorkbookArrayBuffer: readWorkbookArrayBuffer
  };
});
