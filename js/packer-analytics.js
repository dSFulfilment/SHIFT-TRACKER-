/**
 * Packer CSV analytics — parse, clean, aggregate, filter, format.
 * Works in browser (window.PackerAnalytics) and Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PackerAnalytics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NA = 'N/A';

  var SKU_TARGETS = {
    '125': { target: 17, strike: 15.7 },
    '150': { target: 18, strike: 16.3 },
    '200': { target: 17, strike: 15.3 },
    '250': { target: 16, strike: 14.6 },
    '300': { target: 18, strike: 16.0 },
    '400': { target: 16, strike: 14.6 },
    '500': { target: 23, strike: 20.6 },
    '600': { target: 20, strike: 17.8 },
    '700': { target: 21, strike: 19.0 }
  };

  var HEADER_ALIASES = {
    workerName: ['pnp worker name', 'worker name', 'employee name', 'packer name', 'name'],
    station: ['station name', 'station', 'workstation'],
    sku: ['box sku sizes', 'sku', 'box sku', 'primary sku', 'sku size', 'sku sizes'],
    boxes: ['total boxes packed', 'boxes packed', 'total boxes', 'boxes'],
    hours: ['packing time hours', 'packing time (hours)', 'hours', 'packing hours'],
    hourKey: ['report date hour', 'hour', 'report hour', 'date hour'],
    items: ['total items packed', 'items packed', 'items', 'total items'],
    pouches: ['total pouches packed', 'pouches packed', 'pouches', 'total pouches'],
    shift: ['shift', 'shift name', 'shift type'],
    timeSec: ['packing time seconds', 'packing time (seconds)', 'seconds', 'packing seconds'],
    date: ['report date', 'date', 'work date', 'shift date'],
    idle: ['idle time', 'idle time hours', 'idle hours', 'idle time (hours)'],
    shiftHours: ['shift hours', 'shift length hours', 'scheduled hours'],
    target: ['target', 'target bph', 'target boxes per hour', 'bph target']
  };

  var REQUIRED_BY_FORMAT = {
    endOfShift: ['workerName', 'sku', 'boxes', 'hours'],
    summary: ['workerName', 'shift', 'station', 'boxes'],
    hourly: ['workerName', 'hourKey', 'boxes'],
    detailed: ['workerName', 'boxes']
  };

  var TOTALS_NAME_RE = /^(total|totals|grand total|sum|average|avg|subtotal|overall)$/i;

  var KNOWN_SHIFTS = {
    morning: 'morning_shift',
    morning_shift: 'morning_shift',
    day: 'morning_shift',
    am: 'morning_shift',
    afternoon: 'afternoon_shift',
    afternoon_shift: 'afternoon_shift',
    pm: 'afternoon_shift',
    evening: 'evening_shift',
    evening_shift: 'evening_shift',
    night: 'night_shift',
    night_shift: 'night_shift'
  };

  function trimStr(v) {
    return String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim();
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
      return r.length > 1 || (r.length === 1 && r[0] !== '');
    });
  }

  function resolveHeaders(rawHeaders) {
    var normalized = rawHeaders.map(function (h) {
      return trimStr(h);
    });
    var map = {};
    var used = {};
    Object.keys(HEADER_ALIASES).forEach(function (canon) {
      var aliases = HEADER_ALIASES[canon];
      for (var i = 0; i < normalized.length; i++) {
        if (used[i]) continue;
        if (aliases.indexOf(normalized[i].toLowerCase()) !== -1) {
          map[canon] = normalized[i];
          used[i] = true;
          break;
        }
      }
    });
    return map;
  }

  function parseNum(raw) {
    if (raw === undefined || raw === null) return { value: null, valid: true, blank: true };
    var s = trimStr(raw);
    if (s === '') return { value: null, valid: true, blank: true };
    var cleaned = s.replace(/[,$%]/g, '').trim();
    if (cleaned === '') return { value: null, valid: true, blank: true };
    var n = Number(cleaned);
    if (isFinite(n)) return { value: n, valid: true, blank: false };
    return { value: null, valid: false, blank: false };
  }

  function numOrZero(parsed) {
    return parsed && parsed.value != null && isFinite(parsed.value) ? parsed.value : 0;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** Parse AU-friendly dates to YYYY-MM-DD. */
  function parseDate(raw) {
    var s = trimStr(raw);
    if (!s) return null;
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy) {
      var a = parseInt(dmy[1], 10);
      var b = parseInt(dmy[2], 10);
      var y = parseInt(dmy[3], 10);
      if (y < 100) y += 2000;
      var day;
      var month;
      if (a > 12) {
        day = a;
        month = b;
      } else if (b > 12) {
        day = b;
        month = a;
      } else {
        day = a;
        month = b;
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return y + '-' + pad2(month) + '-' + pad2(day);
      }
    }
    return null;
  }

  function parseReportDateFromHourKey(hk) {
    var s = trimStr(hk);
    var iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var us = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (us) return parseDate(us[0]);
    return null;
  }

  function parseHourFromKey(hk) {
    var s = trimStr(hk);
    var m = s.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
    if (!m) {
      var only = s.match(/^(\d{1,2})$/);
      if (only) {
        var h0 = parseInt(only[1], 10);
        return h0 >= 0 && h0 <= 23 ? h0 : null;
      }
      return null;
    }
    var h = parseInt(m[1], 10);
    var ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h >= 0 && h <= 23 ? h : null;
  }

  function normalizeWorkerName(raw) {
    var s = trimStr(raw).replace(/\s+/g, ' ');
    if (!s) return { key: '', display: '', isTotals: false };
    if (TOTALS_NAME_RE.test(s)) return { key: '', display: s, isTotals: true };
    var display = s
      .split(' ')
      .map(function (p) {
        return p.length ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p;
      })
      .join(' ');
    return { key: display.toLowerCase(), display: display, isTotals: false };
  }

  function normalizeStation(raw) {
    var s = trimStr(raw).replace(/\s+/g, ' ');
    if (!s) return '';
    return s.replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function normalizeShift(raw) {
    var s = trimStr(raw).toLowerCase().replace(/\s+/g, '_');
    if (!s) return { key: '', label: '', known: false };
    if (KNOWN_SHIFTS[s]) {
      var key = KNOWN_SHIFTS[s];
      var labels = {
        morning_shift: 'Morning',
        afternoon_shift: 'Afternoon',
        evening_shift: 'Evening',
        night_shift: 'Night'
      };
      return { key: key, label: labels[key] || key, known: true };
    }
    var label = trimStr(raw).replace(/_/g, ' ').replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
    return { key: s, label: label || s, known: false };
  }

  function normalizeSku(raw) {
    var s = trimStr(raw);
    if (!s) return '';
    // Mixed batches ("250,500" / "250 / 500") are not a single SKU size.
    var groups = s.match(/\d+/g) || [];
    if (groups.length > 1) return '';
    if (/[,\/&]| and /i.test(s) && groups.length > 1) return '';
    var digits = s.replace(/[^0-9]/g, '');
    return digits || '';
  }

  function safeDivide(num, den) {
    if (num == null || den == null) return null;
    if (!isFinite(num) || !isFinite(den) || den === 0) return null;
    return num / den;
  }

  function boxesPerHour(boxes, hours) {
    return safeDivide(boxes, hours);
  }
  function itemsPerHour(items, hours) {
    return safeDivide(items, hours);
  }
  function pouchesPerHour(pouches, hours) {
    return safeDivide(pouches, hours);
  }
  function secondsPerBox(seconds, boxes) {
    return safeDivide(seconds, boxes);
  }
  function secondsPerItem(seconds, items) {
    return safeDivide(seconds, items);
  }
  function efficiencyVersusTarget(actual, target) {
    return safeDivide(actual, target);
  }
  function idlePercentage(idle, shiftHours) {
    return safeDivide(idle, shiftHours);
  }

  function performanceStatus(efficiency) {
    if (efficiency == null || !isFinite(efficiency)) {
      return { key: 'unknown', label: 'No target', rank: 99 };
    }
    var pct = efficiency * 100;
    if (pct >= 110) return { key: 'excellent', label: 'Excellent (≥110%)', rank: 0 };
    if (pct >= 95) return { key: 'on_target', label: 'On target (95–109.99%)', rank: 1 };
    return { key: 'needs_attention', label: 'Needs attention (<95%)', rank: 2 };
  }

  function hoursFromSeconds(sec) {
    if (sec == null || !isFinite(sec)) return null;
    return sec / 3600;
  }

  function detectFormat(fieldMap) {
    if (fieldMap.sku && fieldMap.boxes && fieldMap.hours) return 'endOfShift';
    if (fieldMap.shift && fieldMap.station && fieldMap.boxes) return 'summary';
    if (fieldMap.hourKey && fieldMap.boxes) return 'hourly';
    if (fieldMap.workerName && fieldMap.boxes) return 'detailed';
    return null;
  }

  function missingColumnsMessage(format, fieldMap) {
    var needed = REQUIRED_BY_FORMAT[format] || ['workerName', 'boxes'];
    var missing = needed.filter(function (k) {
      return !fieldMap[k];
    });
    if (!missing.length) return null;
    var labels = {
      workerName: 'worker name',
      station: 'station',
      sku: 'SKU',
      boxes: 'boxes',
      hours: 'packing hours',
      hourKey: 'report date hour',
      shift: 'shift'
    };
    return (
      'CSV is missing required column(s): ' +
      missing
        .map(function (k) {
          return labels[k] || k;
        })
        .join(', ') +
      '.'
    );
  }

  function recordFingerprint(rec) {
    return [
      rec.reportDate || '',
      rec.hourKey || (rec.hour != null ? String(rec.hour) : ''),
      rec.workerKey || '',
      rec.shiftKey || '',
      rec.station || '',
      rec.sku || '',
      String(rec.boxes != null ? rec.boxes : ''),
      String(rec.items != null ? rec.items : ''),
      String(rec.packingHours != null ? rec.packingHours : ''),
      String(rec.packingSeconds != null ? rec.packingSeconds : '')
    ].join('|');
  }

  function enrichMetrics(rec) {
    var hours = rec.packingHours;
    if ((hours == null || hours === 0) && rec.packingSeconds != null) {
      hours = hoursFromSeconds(rec.packingSeconds);
    }
    var bph = boxesPerHour(rec.boxes, hours);
    var iph = itemsPerHour(rec.items, hours);
    var pph = pouchesPerHour(rec.pouches, hours);
    var spb = secondsPerBox(rec.packingSeconds, rec.boxes);
    var spi = secondsPerItem(rec.packingSeconds, rec.items);
    var target = rec.targetBph;
    if (target == null && rec.sku && SKU_TARGETS[rec.sku]) target = SKU_TARGETS[rec.sku].target;
    var eff = efficiencyVersusTarget(bph, target);
    var idlePct = idlePercentage(rec.idleHours, rec.shiftHours);
    var status = performanceStatus(eff);
    var calcFailed = [];
    if (bph == null && (rec.boxes > 0 || (hours != null && hours > 0))) calcFailed.push('boxesPerHour');
    if (iph == null && rec.items > 0) calcFailed.push('itemsPerHour');
    if (spb == null && rec.boxes > 0) calcFailed.push('secondsPerBox');
    if (eff == null && bph != null) calcFailed.push('efficiency');
    if (idlePct == null && rec.idleHours != null) calcFailed.push('idlePercentage');

    rec.packingHours = hours;
    rec.calc = {
      boxesPerHour: bph,
      itemsPerHour: iph,
      pouchesPerHour: pph,
      secondsPerBox: spb,
      secondsPerItem: spi,
      efficiency: eff,
      idlePercentage: idlePct,
      targetBph: target != null ? target : null,
      status: status,
      failed: calcFailed
    };
    return rec;
  }

  function rowToRecord(cells, fieldMap, meta) {
    var get = function (canon) {
      var h = fieldMap[canon];
      return h ? cells[h] : '';
    };
    var worker = normalizeWorkerName(get('workerName'));
    if (worker.isTotals) {
      return { skip: true, reason: 'totals_row' };
    }
    if (!worker.key) {
      return { skip: true, reason: 'missing_worker' };
    }

    var boxesP = parseNum(get('boxes'));
    var itemsP = parseNum(get('items'));
    var pouchesP = parseNum(get('pouches'));
    var hoursP = parseNum(get('hours'));
    var secP = parseNum(get('timeSec'));
    var idleP = parseNum(get('idle'));
    var shiftHoursP = parseNum(get('shiftHours'));
    var targetP = parseNum(get('target'));

    var invalidNumeric = [];
    if (!boxesP.valid) invalidNumeric.push('boxes');
    if (!itemsP.valid) invalidNumeric.push('items');
    if (!pouchesP.valid) invalidNumeric.push('pouches');
    if (!hoursP.valid) invalidNumeric.push('hours');
    if (!secP.valid) invalidNumeric.push('timeSec');
    if (!idleP.valid) invalidNumeric.push('idle');
    if (!shiftHoursP.valid) invalidNumeric.push('shiftHours');
    if (!targetP.valid) invalidNumeric.push('target');

    var hourKey = trimStr(get('hourKey'));
    var dateRaw = get('date');
    var reportDate = parseDate(dateRaw) || parseReportDateFromHourKey(hourKey);
    var hour = parseHourFromKey(hourKey);
    var shift = normalizeShift(get('shift') || meta.defaultShift || '');
    var skuRaw = get('sku');
    var sku = normalizeSku(skuRaw);
    var mixedSku = !!(trimStr(skuRaw) && !sku && fieldMap.sku);
    var station = normalizeStation(get('station'));

    var packingHours = hoursP.blank ? null : hoursP.value;
    var packingSeconds = secP.blank ? null : secP.value;
    if (packingHours == null && packingSeconds != null) packingHours = hoursFromSeconds(packingSeconds);
    if (packingSeconds == null && packingHours != null) packingSeconds = packingHours * 3600;

    var raw = {};
    Object.keys(cells).forEach(function (k) {
      raw[k] = cells[k];
    });

    var rec = {
      sourceFile: meta.sourceFile || '',
      sourceIndex: meta.sourceIndex != null ? meta.sourceIndex : null,
      reportDate: reportDate,
      hour: hour,
      hourKey: hourKey || null,
      workerKey: worker.key,
      workerName: worker.display,
      shiftKey: shift.key || meta.defaultShift || '',
      shiftLabel: shift.label || '',
      shiftKnown: shift.known || !!(meta.defaultShift && KNOWN_SHIFTS[meta.defaultShift]),
      station: station,
      sku: sku,
      boxes: numOrZero(boxesP),
      items: numOrZero(itemsP),
      pouches: numOrZero(pouchesP),
      packingHours: packingHours,
      packingSeconds: packingSeconds,
      idleHours: idleP.blank ? null : idleP.value,
      shiftHours: shiftHoursP.blank ? null : shiftHoursP.value,
      targetBph: targetP.blank ? null : targetP.value,
      invalidNumeric: invalidNumeric,
      mixedSku: mixedSku,
      raw: raw
    };
    enrichMetrics(rec);
    rec.id = recordFingerprint(rec);
    return { skip: false, record: rec, invalidNumeric: invalidNumeric, mixedSku: mixedSku };
  }

  /**
   * Parse a CSV string into cleaned records + quality stats.
   * Does not mutate the original text.
   */
  function processCsvText(text, options) {
    options = options || {};
    var rawText = String(text == null ? '' : text);
    var rows = parseCSV(rawText);
    if (rows.length < 2) {
      return {
        ok: false,
        error: 'That file looks empty — no header row and data rows were found.',
        records: [],
        quality: emptyQuality(),
        rawText: rawText
      };
    }

    var rawHeaders = rows[0].map(trimStr);
    var fieldMap = resolveHeaders(rawHeaders);
    if (!fieldMap.workerName) {
      return {
        ok: false,
        error:
          'Unrecognized CSV format — no worker-name column found (expected one of: Pnp Worker Name, Worker Name, Employee Name, Packer Name).',
        records: [],
        quality: emptyQuality(),
        rawHeaders: rawHeaders,
        fieldMap: fieldMap,
        rawText: rawText
      };
    }

    var format = detectFormat(fieldMap);
    if (!format) {
      return {
        ok: false,
        error:
          'Unrecognized CSV format — columns found don’t match a shift summary, hourly, end-of-shift, or detailed export.',
        records: [],
        quality: emptyQuality(),
        rawHeaders: rawHeaders,
        fieldMap: fieldMap,
        rawText: rawText
      };
    }

    var missingMsg = missingColumnsMessage(format, fieldMap);
    if (missingMsg) {
      return {
        ok: false,
        error: missingMsg,
        records: [],
        quality: emptyQuality(),
        rawHeaders: rawHeaders,
        fieldMap: fieldMap,
        format: format,
        rawText: rawText
      };
    }

    var quality = emptyQuality();
    var records = [];
    var seenInFile = {};

    rows.slice(1).forEach(function (r, idx) {
      var isBlank = r.every(function (c) {
        return trimStr(c) === '';
      });
      if (isBlank) {
        quality.blankRows++;
        quality.invalidRows++;
        return;
      }
      var cells = {};
      rawHeaders.forEach(function (h, i) {
        cells[h] = trimStr(r[i] !== undefined ? r[i] : '');
      });
      var result = rowToRecord(cells, fieldMap, {
        sourceFile: options.sourceFile || '',
        sourceIndex: idx + 2,
        defaultShift: options.defaultShift || ''
      });
      if (result.skip) {
        quality.invalidRows++;
        if (result.reason === 'missing_worker') quality.missingWorkerNames++;
        if (result.reason === 'totals_row') quality.totalsRowsSkipped++;
        return;
      }
      var rec = result.record;
      quality.validRows++;
      if (!rec.reportDate) quality.missingDates++;
      if (rec.packingHours == null && rec.packingSeconds == null) quality.missingPackingTime++;
      if (!rec.shiftKnown && rec.shiftKey) quality.unknownShifts++;
      if (result.mixedSku) quality.mixedSkuRows++;
      if (result.invalidNumeric && result.invalidNumeric.length) {
        quality.invalidNumericValues += result.invalidNumeric.length;
      }
      if (rec.calc && rec.calc.failed && rec.calc.failed.length) {
        quality.failedCalculations += rec.calc.failed.length;
      }
      if (seenInFile[rec.id]) {
        quality.duplicateRows++;
        return;
      }
      seenInFile[rec.id] = true;
      records.push(rec);
    });

    if (!records.length) {
      return {
        ok: false,
        error:
          'No usable worker rows found' +
          (quality.missingWorkerNames
            ? ' (' + quality.missingWorkerNames + ' row(s) were missing a worker name)'
            : '') +
          (quality.totalsRowsSkipped ? ' (' + quality.totalsRowsSkipped + ' totals row(s) skipped)' : '') +
          '.',
        records: [],
        quality: quality,
        rawHeaders: rawHeaders,
        fieldMap: fieldMap,
        format: format,
        rawText: rawText
      };
    }

    return {
      ok: true,
      records: records,
      quality: quality,
      rawHeaders: rawHeaders,
      fieldMap: fieldMap,
      format: format,
      rawText: rawText,
      error: null
    };
  }

  function emptyQuality() {
    return {
      validRows: 0,
      invalidRows: 0,
      blankRows: 0,
      missingWorkerNames: 0,
      missingDates: 0,
      missingPackingTime: 0,
      duplicateRows: 0,
      unknownShifts: 0,
      totalsRowsSkipped: 0,
      invalidNumericValues: 0,
      failedCalculations: 0,
      mixedSkuRows: 0
    };
  }

  function mergeQuality(a, b) {
    var out = emptyQuality();
    Object.keys(out).forEach(function (k) {
      out[k] = (a && a[k] ? a[k] : 0) + (b && b[k] ? b[k] : 0);
    });
    return out;
  }

  /** Combine record lists, dropping duplicates by fingerprint. */
  function mergeRecords(existing, incoming) {
    var map = {};
    var out = [];
    var dupes = 0;
    (existing || []).concat(incoming || []).forEach(function (rec) {
      if (!rec || !rec.id) return;
      if (map[rec.id]) {
        dupes++;
        return;
      }
      map[rec.id] = true;
      out.push(rec);
    });
    return { records: out, duplicatesRemoved: dupes };
  }

  function filterRecords(records, filters) {
    filters = filters || {};
    var minPerf = filters.minPerformance;
    if (minPerf != null && minPerf !== '') minPerf = Number(minPerf);
    else minPerf = null;

    return (records || []).filter(function (r) {
      if (filters.reportDate && r.reportDate !== filters.reportDate) return false;
      if (filters.shift && r.shiftKey !== filters.shift) return false;
      if (filters.worker && r.workerKey !== filters.worker) return false;
      if (filters.station && r.station !== filters.station) return false;
      if (filters.sku && r.sku !== filters.sku) return false;
      if (filters.hour != null && filters.hour !== '' && r.hour !== Number(filters.hour)) return false;
      if (filters.search) {
        var q = String(filters.search).toLowerCase();
        var hay = (r.workerName + ' ' + r.station + ' ' + r.sku + ' ' + r.shiftLabel).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (minPerf != null && isFinite(minPerf)) {
        var bph = r.calc && r.calc.boxesPerHour;
        if (bph == null || bph < minPerf) return false;
      }
      return true;
    });
  }

  function weightedAverage(pairs) {
    // pairs: [{ value, weight }]
    var wSum = 0;
    var vSum = 0;
    var n = 0;
    (pairs || []).forEach(function (p) {
      if (p.value == null || !isFinite(p.value) || p.weight == null || !isFinite(p.weight) || p.weight <= 0)
        return;
      vSum += p.value * p.weight;
      wSum += p.weight;
      n++;
    });
    if (!n || wSum <= 0) return null;
    return vSum / wSum;
  }

  function sumField(records, field) {
    var t = 0;
    (records || []).forEach(function (r) {
      var v = r[field];
      if (v != null && isFinite(v)) t += v;
    });
    return t;
  }

  function sumCalc(records, field) {
    var t = 0;
    var any = false;
    (records || []).forEach(function (r) {
      var v = r.calc && r.calc[field];
      if (v != null && isFinite(v)) {
        t += v;
        any = true;
      }
    });
    return any ? t : null;
  }

  function aggregateKpis(records) {
    var totalBoxes = sumField(records, 'boxes');
    var totalItems = sumField(records, 'items');
    var totalHours = sumField(records, 'packingHours');
    var workers = {};
    (records || []).forEach(function (r) {
      if (r.workerKey) workers[r.workerKey] = true;
    });
    var avgBph = safeDivide(totalBoxes, totalHours);
    var effPairs = (records || []).map(function (r) {
      return {
        value: r.calc && r.calc.efficiency,
        weight: r.packingHours != null && r.packingHours > 0 ? r.packingHours : r.boxes || 0
      };
    });
    var avgEff = weightedAverage(effPairs);
    var idlePairs = (records || []).map(function (r) {
      return {
        value: r.calc && r.calc.idlePercentage,
        weight: r.shiftHours != null && r.shiftHours > 0 ? r.shiftHours : r.packingHours || 0
      };
    });
    var avgIdle = weightedAverage(idlePairs);

    return {
      totalBoxes: totalBoxes,
      totalItems: totalItems,
      averageBoxesPerHour: avgBph,
      averageEfficiency: avgEff,
      totalPackingHours: totalHours > 0 ? totalHours : null,
      averageIdlePercentage: avgIdle,
      activeWorkers: Object.keys(workers).length
    };
  }

  function aggregateWorkers(records) {
    var by = {};
    (records || []).forEach(function (r) {
      var k = r.workerKey;
      if (!k) return;
      if (!by[k]) {
        by[k] = {
          workerKey: k,
          workerName: r.workerName,
          shifts: {},
          stations: {},
          skus: {},
          boxes: 0,
          items: 0,
          pouches: 0,
          packingHours: 0,
          packingSeconds: 0,
          idleHours: 0,
          shiftHours: 0,
          hasIdle: false,
          hasShiftHours: false,
          dates: {},
          hours: {},
          targetWeighted: [],
          rows: 0
        };
      }
      var g = by[k];
      g.rows++;
      g.boxes += r.boxes || 0;
      g.items += r.items || 0;
      g.pouches += r.pouches || 0;
      if (r.packingHours != null) g.packingHours += r.packingHours;
      if (r.packingSeconds != null) g.packingSeconds += r.packingSeconds;
      if (r.idleHours != null) {
        g.idleHours += r.idleHours;
        g.hasIdle = true;
      }
      if (r.shiftHours != null) {
        g.shiftHours += r.shiftHours;
        g.hasShiftHours = true;
      }
      if (r.shiftKey) g.shifts[r.shiftKey] = r.shiftLabel || r.shiftKey;
      if (r.station) g.stations[r.station] = (g.stations[r.station] || 0) + (r.boxes || 0);
      if (r.sku) g.skus[r.sku] = (g.skus[r.sku] || 0) + (r.boxes || 0);
      if (r.reportDate) g.dates[r.reportDate] = (g.dates[r.reportDate] || 0) + (r.boxes || 0);
      if (r.hour != null) g.hours[r.hour] = (g.hours[r.hour] || 0) + (r.boxes || 0);
      var t = r.calc && r.calc.targetBph;
      if (t != null) {
        g.targetWeighted.push({
          value: t,
          weight: r.packingHours != null && r.packingHours > 0 ? r.packingHours : r.boxes || 1
        });
      }
    });

    return Object.keys(by)
      .map(function (k) {
        var g = by[k];
        var hours = g.packingHours > 0 ? g.packingHours : hoursFromSeconds(g.packingSeconds);
        var bph = boxesPerHour(g.boxes, hours);
        var iph = itemsPerHour(g.items, hours);
        var spb = secondsPerBox(g.packingSeconds > 0 ? g.packingSeconds : hours != null ? hours * 3600 : null, g.boxes);
        var target = weightedAverage(g.targetWeighted);
        if (target == null) {
          var skuKeys = Object.keys(g.skus);
          if (skuKeys.length === 1 && SKU_TARGETS[skuKeys[0]]) target = SKU_TARGETS[skuKeys[0]].target;
        }
        var eff = efficiencyVersusTarget(bph, target);
        var idlePct =
          g.hasIdle && g.hasShiftHours ? idlePercentage(g.idleHours, g.shiftHours) : null;
        var status = performanceStatus(eff);
        var shiftLabels = Object.keys(g.shifts)
          .map(function (sk) {
            return g.shifts[sk];
          })
          .join(', ');
        var stationLabels = Object.keys(g.stations).sort(function (a, b) {
          return g.stations[b] - g.stations[a];
        });
        return {
          workerKey: g.workerKey,
          workerName: g.workerName,
          shift: shiftLabels || '—',
          station: stationLabels[0] || '—',
          stations: stationLabels,
          skus: g.skus,
          boxes: g.boxes,
          items: g.items,
          packingHours: hours,
          boxesPerHour: bph,
          itemsPerHour: iph,
          secondsPerBox: spb,
          efficiency: eff,
          idlePercentage: idlePct,
          status: status,
          dates: g.dates,
          hours: g.hours,
          rows: g.rows,
          // weighted score for ranking: prefer BPH weighted by hours (falls back to boxes)
          rankScore: bph != null ? bph : -1,
          weight: hours != null && hours > 0 ? hours : g.boxes
        };
      })
      .sort(function (a, b) {
        // Rank by boxes/hour (weighted performance), then boxes
        if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
        return b.boxes - a.boxes;
      })
      .map(function (row, i) {
        row.rank = i + 1;
        return row;
      });
  }

  function aggregateByHour(records) {
    var by = {};
    (records || []).forEach(function (r) {
      if (r.hour == null) return;
      if (!by[r.hour]) by[r.hour] = { hour: r.hour, boxes: 0, items: 0, packingHours: 0 };
      by[r.hour].boxes += r.boxes || 0;
      by[r.hour].items += r.items || 0;
      if (r.packingHours != null) by[r.hour].packingHours += r.packingHours;
    });
    return Object.keys(by)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .map(function (h) {
        var g = by[h];
        g.boxesPerHour = boxesPerHour(g.boxes, g.packingHours > 0 ? g.packingHours : null);
        return g;
      });
  }

  function aggregateByDimension(records, keyFn, labelFn) {
    var by = {};
    (records || []).forEach(function (r) {
      var key = keyFn(r);
      if (!key) return;
      if (!by[key]) {
        by[key] = {
          key: key,
          label: labelFn ? labelFn(r, key) : key,
          boxes: 0,
          items: 0,
          packingHours: 0,
          workers: {}
        };
      }
      by[key].boxes += r.boxes || 0;
      by[key].items += r.items || 0;
      if (r.packingHours != null) by[key].packingHours += r.packingHours;
      if (r.workerKey) by[key].workers[r.workerKey] = true;
    });
    return Object.keys(by)
      .map(function (k) {
        var g = by[k];
        g.boxesPerHour = boxesPerHour(g.boxes, g.packingHours > 0 ? g.packingHours : null);
        g.workerCount = Object.keys(g.workers).length;
        delete g.workers;
        return g;
      })
      .sort(function (a, b) {
        var ab = a.boxesPerHour != null ? a.boxesPerHour : -1;
        var bb = b.boxesPerHour != null ? b.boxesPerHour : -1;
        if (bb !== ab) return bb - ab;
        return b.boxes - a.boxes;
      });
  }

  function aggregateStations(records) {
    return aggregateByDimension(
      records,
      function (r) {
        return r.station || '';
      },
      function (r) {
        return r.station;
      }
    );
  }

  function aggregateSkus(records) {
    return aggregateByDimension(
      records,
      function (r) {
        return r.sku || '';
      },
      function (r) {
        return r.sku;
      }
    );
  }

  function aggregateShifts(records) {
    return aggregateByDimension(
      records,
      function (r) {
        return r.shiftKey || '';
      },
      function (r) {
        return r.shiftLabel || r.shiftKey;
      }
    );
  }

  function workerDetail(records, workerKey) {
    var filtered = (records || []).filter(function (r) {
      return r.workerKey === workerKey;
    });
    var summary = aggregateWorkers(filtered)[0] || null;
    var byDate = {};
    filtered.forEach(function (r) {
      var d = r.reportDate || 'unknown';
      if (!byDate[d]) byDate[d] = { date: d, boxes: 0, packingHours: 0, items: 0 };
      byDate[d].boxes += r.boxes || 0;
      byDate[d].items += r.items || 0;
      if (r.packingHours != null) byDate[d].packingHours += r.packingHours;
    });
    var daily = Object.keys(byDate)
      .sort()
      .map(function (d) {
        var g = byDate[d];
        g.boxesPerHour = boxesPerHour(g.boxes, g.packingHours > 0 ? g.packingHours : null);
        return g;
      });
    return {
      summary: summary,
      records: filtered,
      daily: daily,
      hourly: aggregateByHour(filtered),
      stations: aggregateStations(filtered),
      skus: aggregateSkus(filtered)
    };
  }

  function uniqueOptions(records) {
    var dates = {};
    var shifts = {};
    var workers = {};
    var stations = {};
    var skus = {};
    var hours = {};
    (records || []).forEach(function (r) {
      if (r.reportDate) dates[r.reportDate] = true;
      if (r.shiftKey) shifts[r.shiftKey] = r.shiftLabel || r.shiftKey;
      if (r.workerKey) workers[r.workerKey] = r.workerName;
      if (r.station) stations[r.station] = true;
      if (r.sku) skus[r.sku] = true;
      if (r.hour != null) hours[r.hour] = true;
    });
    return {
      dates: Object.keys(dates).sort().reverse(),
      shifts: Object.keys(shifts)
        .sort()
        .map(function (k) {
          return { key: k, label: shifts[k] };
        }),
      workers: Object.keys(workers)
        .sort(function (a, b) {
          return workers[a].localeCompare(workers[b]);
        })
        .map(function (k) {
          return { key: k, label: workers[k] };
        }),
      stations: Object.keys(stations).sort(),
      skus: Object.keys(skus).sort(function (a, b) {
        return Number(a) - Number(b);
      }),
      hours: Object.keys(hours)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        })
    };
  }

  function summarizeQuality(records, quality) {
    var q = quality ? mergeQuality(emptyQuality(), quality) : emptyQuality();
    if (!quality && records) {
      q.validRows = records.length;
      records.forEach(function (r) {
        if (!r.reportDate) q.missingDates++;
        if (r.packingHours == null && r.packingSeconds == null) q.missingPackingTime++;
        if (!r.shiftKnown && r.shiftKey) q.unknownShifts++;
        if (r.calc && r.calc.failed) q.failedCalculations += r.calc.failed.length;
      });
    }
    return q;
  }

  // ── Formatting (AU) ────────────────────────────────────────────────
  function formatDateAU(iso) {
    if (!iso) return NA;
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    return pad2(parseInt(p[2], 10)) + '/' + pad2(parseInt(p[1], 10)) + '/' + p[0];
  }

  function formatDateLongAU(iso) {
    if (!iso) return NA;
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    if (isNaN(d.getTime())) return formatDateAU(iso);
    return d.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  function formatNumber(n, digits) {
    if (n == null || !isFinite(n)) return NA;
    var d = digits == null ? 0 : digits;
    return Number(n).toLocaleString('en-AU', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  function formatRate(n) {
    return n == null || !isFinite(n) ? NA : formatNumber(n, 1);
  }

  function formatPercent(ratio) {
    if (ratio == null || !isFinite(ratio)) return NA;
    return formatNumber(ratio * 100, 1) + '%';
  }

  function formatHours(h) {
    if (h == null || !isFinite(h)) return NA;
    if (h < 1) return formatNumber(h * 60, 0) + ' min';
    return formatNumber(h, 2) + ' h';
  }

  function formatSeconds(s) {
    if (s == null || !isFinite(s)) return NA;
    return formatNumber(s, 1) + ' s';
  }

  function formatHourLabel(h) {
    if (h == null || !isFinite(h)) return NA;
    var ap = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ap;
  }

  /** Convert legacy shift-keyed storage into flat records (best-effort). */
  function migrateLegacyShifts(shiftsData) {
    var records = [];
    Object.keys(shiftsData || {}).forEach(function (shiftKey) {
      var s = shiftsData[shiftKey] || {};
      var shift = normalizeShift(shiftKey);
      Object.keys(s.summary || {}).forEach(function (wk) {
        var w = s.summary[wk];
        var stations = w.stations && w.stations.length ? w.stations : [''];
        stations.forEach(function (st) {
          var rec = enrichMetrics({
            sourceFile: '(migrated)',
            reportDate: s.reportDate || null,
            hour: null,
            hourKey: null,
            workerKey: normalizeWorkerName(w.name || wk).key,
            workerName: normalizeWorkerName(w.name || wk).display,
            shiftKey: shift.key || shiftKey,
            shiftLabel: shift.label || shiftKey,
            shiftKnown: !!shift.known,
            station: normalizeStation(st),
            sku: '',
            boxes: w.boxes || 0,
            items: w.items || 0,
            pouches: w.pouches || 0,
            packingHours: w.timeSec ? w.timeSec / 3600 : null,
            packingSeconds: w.timeSec || null,
            idleHours: null,
            shiftHours: null,
            targetBph: null,
            raw: { migrated: true }
          });
          rec.id = recordFingerprint(rec);
          records.push(rec);
        });
      });
      Object.keys(s.hourly || {}).forEach(function (hk) {
        Object.keys(s.hourly[hk] || {}).forEach(function (wk) {
          var boxes = s.hourly[hk][wk] || 0;
          var worker = normalizeWorkerName(wk);
          var rec = enrichMetrics({
            sourceFile: '(migrated-hourly)',
            reportDate: parseReportDateFromHourKey(hk) || s.reportDate || null,
            hour: parseHourFromKey(hk),
            hourKey: hk,
            workerKey: worker.key,
            workerName: worker.display,
            shiftKey: shift.key || shiftKey,
            shiftLabel: shift.label || shiftKey,
            shiftKnown: !!shift.known,
            station: '',
            sku: '',
            boxes: boxes,
            items: 0,
            pouches: 0,
            packingHours: null,
            packingSeconds: null,
            idleHours: null,
            shiftHours: null,
            targetBph: null,
            raw: { migrated: true, hourKey: hk }
          });
          rec.id = recordFingerprint(rec);
          records.push(rec);
        });
      });
      if (s.endOfShift && s.endOfShift.results) {
        s.endOfShift.results.forEach(function (r) {
          var worker = normalizeWorkerName(r.worker);
          var hours = r.bph > 0 && r.boxes ? r.boxes / r.bph : null;
          var rec = enrichMetrics({
            sourceFile: '(migrated-eos)',
            reportDate: s.reportDate || null,
            hour: null,
            hourKey: null,
            workerKey: r.workerKey || worker.key,
            workerName: worker.display,
            shiftKey: shift.key || shiftKey,
            shiftLabel: shift.label || shiftKey,
            shiftKnown: !!shift.known,
            station: '',
            sku: normalizeSku(r.sku),
            boxes: r.boxes || 0,
            items: 0,
            pouches: 0,
            packingHours: hours,
            packingSeconds: hours != null ? hours * 3600 : null,
            idleHours: null,
            shiftHours: null,
            targetBph: r.target != null ? r.target : null,
            raw: { migrated: true }
          });
          rec.id = recordFingerprint(rec);
          records.push(rec);
        });
      }
    });
    return mergeRecords([], records).records;
  }

  function sortRows(rows, sortKey, dir) {
    var mult = dir === 'asc' ? 1 : -1;
    var list = (rows || []).slice();
    list.sort(function (a, b) {
      var av = a[sortKey];
      var bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * mult;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
    return list;
  }

  function paginate(rows, page, pageSize) {
    page = Math.max(1, page || 1);
    pageSize = Math.max(1, pageSize || 25);
    var total = (rows || []).length;
    var pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) page = pages;
    var start = (page - 1) * pageSize;
    return {
      rows: (rows || []).slice(start, start + pageSize),
      page: page,
      pageSize: pageSize,
      total: total,
      pages: pages
    };
  }

  return {
    NA: NA,
    SKU_TARGETS: SKU_TARGETS,
    HEADER_ALIASES: HEADER_ALIASES,
    parseCSV: parseCSV,
    stripBOM: stripBOM,
    resolveHeaders: resolveHeaders,
    parseNum: parseNum,
    parseDate: parseDate,
    parseReportDateFromHourKey: parseReportDateFromHourKey,
    parseHourFromKey: parseHourFromKey,
    normalizeWorkerName: normalizeWorkerName,
    normalizeStation: normalizeStation,
    normalizeShift: normalizeShift,
    normalizeSku: normalizeSku,
    safeDivide: safeDivide,
    boxesPerHour: boxesPerHour,
    itemsPerHour: itemsPerHour,
    pouchesPerHour: pouchesPerHour,
    secondsPerBox: secondsPerBox,
    secondsPerItem: secondsPerItem,
    efficiencyVersusTarget: efficiencyVersusTarget,
    idlePercentage: idlePercentage,
    performanceStatus: performanceStatus,
    processCsvText: processCsvText,
    recordFingerprint: recordFingerprint,
    mergeRecords: mergeRecords,
    mergeQuality: mergeQuality,
    emptyQuality: emptyQuality,
    filterRecords: filterRecords,
    weightedAverage: weightedAverage,
    aggregateKpis: aggregateKpis,
    aggregateWorkers: aggregateWorkers,
    aggregateByHour: aggregateByHour,
    aggregateStations: aggregateStations,
    aggregateSkus: aggregateSkus,
    aggregateShifts: aggregateShifts,
    workerDetail: workerDetail,
    uniqueOptions: uniqueOptions,
    summarizeQuality: summarizeQuality,
    formatDateAU: formatDateAU,
    formatDateLongAU: formatDateLongAU,
    formatNumber: formatNumber,
    formatRate: formatRate,
    formatPercent: formatPercent,
    formatHours: formatHours,
    formatSeconds: formatSeconds,
    formatHourLabel: formatHourLabel,
    migrateLegacyShifts: migrateLegacyShifts,
    sortRows: sortRows,
    paginate: paginate,
    enrichMetrics: enrichMetrics
  };
});
