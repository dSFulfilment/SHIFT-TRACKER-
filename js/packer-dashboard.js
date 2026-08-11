/**
 * Packer CSV performance dashboard UI (inlined into index.html for offline use).
 * Day / Afternoon × Mon–Fri calendar, preview-before-import, week export-before-clear.
 */
(function () {
  'use strict';

  var PA = window.PackerAnalytics;
  if (!PA) {
    console.error('PackerAnalytics module missing');
    return;
  }

  var STORAGE_KEY = 'packer-shift-data';
  var PAGE_SIZE = 25;
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  var SHIFT_KEYS = [
    { key: 'morning', label: 'Day' },
    { key: 'afternoon', label: 'Afternoon' }
  ];

  var state = {
    schemaVersion: 1,
    revision: 0,
    version: 3,
    activeWeekKey: '',
    weekStart: null,
    dayIdx: 0,
    rosterShift: 'morning', // morning | afternoon — mirrors Roster
    byDate: {},
    archives: {},
    legacy: { records: [], files: [], quality: PA.emptyQuality() },
    showLegacy: false,
    filters: {
      reportDate: '',
      shift: '',
      worker: '',
      station: '',
      sku: '',
      hour: '',
      status: '', // on | below | strike — People view only
      minPerformance: '',
      search: ''
    },
    sortKey: 'rankScore',
    sortDir: 'desc',
    page: 1,
    selectedWorker: null,
    loading: false,
    error: null,
    view: 'people', // people | hours
    pendingImport: null // { files: [{name,text,result}], fallbackDate, fallbackShift, mode }
  };

  /** Map CSV shiftKey → calendar morning|afternoon. Intra hour has no shift — use hour (≥14 = Afternoon). */
  function rosterShiftFromRecord(rec, fallback) {
    var sk = (rec && rec.shiftKey) || '';
    if (/afternoon|evening|night/i.test(sk)) return 'afternoon';
    if (/morning|day|^am$/i.test(sk)) return 'morning';
    if (rec && rec.hour != null && isFinite(rec.hour)) {
      return rec.hour >= 14 ? 'afternoon' : 'morning';
    }
    return fallback === 'afternoon' ? 'afternoon' : 'morning';
  }

  /** Group import rows into byDate buckets using each row's report date + shift. */
  function groupImportRecords(records, fallbackDate, fallbackShift) {
    var groups = {};
    (records || []).forEach(function (rec) {
      var date = (rec && rec.reportDate) || fallbackDate || '';
      if (!date) return;
      var shift = rosterShiftFromRecord(rec, fallbackShift);
      var key = date + '|' + shift;
      if (!groups[key]) groups[key] = { date: date, shift: shift, records: [] };
      groups[key].records.push(rec);
    });
    return groups;
  }

  function summarizeImportPlan(files, fallbackDate, fallbackShift) {
    var totals = {};
    var formats = {};
    (files || []).forEach(function (f) {
      var res = f && f.result;
      if (!res || !res.ok) return;
      if (res.format) formats[res.format] = (formats[res.format] || 0) + 1;
      var groups = groupImportRecords(res.records, fallbackDate, fallbackShift);
      Object.keys(groups).forEach(function (k) {
        if (!totals[k]) totals[k] = { date: groups[k].date, shift: groups[k].shift, count: 0 };
        totals[k].count += groups[k].records.length;
      });
    });
    var buckets = Object.keys(totals).sort().map(function (k) { return totals[k]; });
    buckets.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.shift < b.shift ? -1 : 1;
    });
    return { buckets: buckets, formats: formats };
  }

  function preferViewFromFormats(formats) {
    var hasHourly = !!(formats && formats.hourly);
    var hasPeople = !!(formats && (formats.summary || formats.detailed || formats.endOfShift));
    if (hasHourly && !hasPeople) return 'hours';
    return 'people';
  }

  var els = {
    lastUpdated: document.getElementById('pkLastUpdated'),
    fileInput: document.getElementById('pkFileInput'),
    uploadBtn: document.getElementById('pkUploadBtn'),
    clearBtn: document.getElementById('pkClearBtn'),
    shiftToggle: document.getElementById('pkShift'),
    daysEl: document.getElementById('pkDays'),
    weekLabel: document.getElementById('pkWeekLabel'),
    prevWeek: document.getElementById('pkPrevWeek'),
    nextWeek: document.getElementById('pkNextWeek'),
    jumpToday: document.getElementById('pkJumpToday'),
    searchInput: document.getElementById('pkSearchInput'),
    views: document.getElementById('pkViews'),
    chipBar: document.getElementById('pkChipBar'),
    filters: document.getElementById('pkFilters'),
    kpis: document.getElementById('pkKpis'),
    charts: document.getElementById('pkCharts'),
    tableWrap: document.getElementById('pkTableWrap'),
    quality: document.getElementById('pkQuality'),
    detail: document.getElementById('pkDetail'),
    status: document.getElementById('pkStatus'),
    toast: document.getElementById('packerToast'),
    preview: document.getElementById('pkPreview')
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = x.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }
  function weekLabel(ws) {
    var we = addDays(ws, 4);
    var opts = { month: 'short', day: 'numeric' };
    return ws.toLocaleDateString('en-AU', opts) + ' – ' + we.toLocaleDateString('en-AU', opts);
  }
  function toast(msg, type) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.style.background = type === 'err' ? '#c01c14' : '#0d1117';
    els.toast.style.color = '#fff';
    els.toast.classList.add('show');
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 3200);
  }
  function uid() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function downloadTextFile(filename, text, mime) {
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
      a.download = filename;
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 2000);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
  function shiftLabel(key) {
    return key === 'afternoon' ? 'Afternoon' : 'Day';
  }
  function emptyBucket() {
    return { records: [], files: [], quality: PA.emptyQuality() };
  }
  function ensureBucket(dateKey, shiftKey) {
    if (!state.byDate[dateKey]) state.byDate[dateKey] = {};
    if (!state.byDate[dateKey][shiftKey]) state.byDate[dateKey][shiftKey] = emptyBucket();
    return state.byDate[dateKey][shiftKey];
  }
  function activeDateKey() {
    if (!state.weekStart) state.weekStart = startOfWeek(new Date());
    return ymd(addDays(state.weekStart, state.dayIdx));
  }
  function activeBucket() {
    return ensureBucket(activeDateKey(), state.rosterShift === 'afternoon' ? 'afternoon' : 'morning');
  }
  function currentRecords() {
    return activeBucket().records || [];
  }
  function currentQuality() {
    return activeBucket().quality || PA.emptyQuality();
  }
  function currentFiles() {
    return activeBucket().files || [];
  }
  function filtered() {
    // View-specific chips: hour is Hours-only (Boxes Packed rows have no hour),
    // SKU/status are People-only.
    var f = {
      reportDate: state.filters.reportDate,
      shift: state.filters.shift,
      worker: state.filters.worker,
      station: state.filters.station,
      sku: state.view === 'hours' ? '' : state.filters.sku,
      hour: state.view === 'hours' ? state.filters.hour : '',
      minPerformance: state.filters.minPerformance,
      search: state.filters.search
    };
    return PA.filterRecords(currentRecords(), f);
  }

  /** People rows after SKU/search filters, then optional Status chip. */
  function peopleRowsFiltered() {
    var rows = PA.aggregatePeopleRows(filtered());
    if (state.view !== 'hours' && state.filters.status) {
      rows = rows.filter(function (r) {
        return r.strikeStatus && r.strikeStatus.key === state.filters.status;
      });
    }
    return rows;
  }

  function availableSkus(records) {
    var set = {};
    (records || []).forEach(function (r) {
      if (r.sku && r.packingHours != null && r.packingHours > 0) set[r.sku] = true;
    });
    return Object.keys(set).sort(function (a, b) { return Number(a) - Number(b); });
  }

  function availableHours(records) {
    var set = {};
    (records || []).forEach(function (r) {
      if (r.hour != null && isFinite(r.hour)) set[r.hour] = true;
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function skuSectionStats(records) {
    var by = {};
    (records || []).forEach(function (r) {
      if (!r.sku || r.packingHours == null || r.packingHours <= 0) return;
      if (!by[r.sku]) by[r.sku] = { boxes: 0, hours: 0 };
      by[r.sku].boxes += r.boxes || 0;
      by[r.sku].hours += r.packingHours || 0;
    });
    return by;
  }

  function chipBtn(filterKey, value, label, opts) {
    opts = opts || {};
    var cur = state.filters[filterKey];
    if (filterKey === 'hour') cur = cur === '' || cur == null ? '' : String(cur);
    var active = String(cur == null ? '' : cur) === String(value);
    var cls = 'pk-chip' + (active ? ' active' : '') + (opts.tone ? ' ' + opts.tone : '');
    var meta = opts.meta ? '<span class="pk-chip-meta">' + escapeHtml(opts.meta) + '</span>' : '';
    return '<button type="button" class="' + cls + '" data-filter="' + escapeHtml(filterKey) +
      '" data-value="' + escapeHtml(String(value)) + '">' + escapeHtml(label) + meta + '</button>';
  }

  function renderChipBar() {
    if (!els.chipBar) return;
    var recs = currentRecords();
    if (!recs.length) {
      els.chipBar.hidden = true;
      els.chipBar.innerHTML = '';
      return;
    }
    var html = '';
    if (state.view === 'hours') {
      var hours = availableHours(recs);
      if (state.filters.hour !== '' && state.filters.hour != null &&
          hours.indexOf(Number(state.filters.hour)) === -1) {
        state.filters.hour = '';
      }
      html += '<div class="pk-chip-row"><span class="pk-chip-lbl">Hour</span>' +
        chipBtn('hour', '', 'All');
      hours.forEach(function (h) {
        html += chipBtn('hour', String(h), PA.formatHourLabel(h));
      });
      html += '</div>';
    } else {
      var skus = availableSkus(recs);
      var skuStats = skuSectionStats(recs);
      if (state.filters.sku && skus.indexOf(state.filters.sku) === -1) state.filters.sku = '';
      html += '<div class="pk-chip-row"><span class="pk-chip-lbl">SKU</span>' +
        chipBtn('sku', '', 'All');
      skus.forEach(function (sku) {
        var st = skuStats[sku];
        var bph = st && st.hours > 0 ? st.boxes / st.hours : null;
        var meta = bph != null ? PA.formatRate(bph) : '';
        html += chipBtn('sku', sku, sku, { meta: meta });
      });
      html += '</div>';
      html += '<div class="pk-chip-row"><span class="pk-chip-lbl">Status</span>' +
        chipBtn('status', '', 'All') +
        chipBtn('status', 'on', 'Hit', { tone: 'on' }) +
        chipBtn('status', 'below', 'Below', { tone: 'below' }) +
        chipBtn('status', 'strike', 'Strike', { tone: 'strike' }) +
        '</div>';
    }
    els.chipBar.innerHTML = html;
    els.chipBar.hidden = !html;
  }

  function strikePill(st) {
    if (!st) return '<span class="pk-status pk-status-unknown">No target</span>';
    var cls =
      st.key === 'on' ? 'pk-status-excellent'
        : st.key === 'below' ? 'pk-status-below'
          : st.key === 'strike' ? 'pk-status-strike'
            : 'pk-status-unknown';
    return '<span class="pk-status ' + cls + '" title="' + escapeHtml(st.label) + '">' + escapeHtml(st.label) + '</span>';
  }

  function barChart(items, valueKey, labelKey, opts) {
    opts = opts || {};
    var max = 0;
    items.forEach(function (it) {
      var v = it[valueKey];
      if (v != null && v > max) max = v;
    });
    if (!items.length) return '<div class="pk-empty-inline">No data for this chart</div>';
    if (max <= 0) max = 1;
    return '<div class="pk-bars">' + items.slice(0, opts.limit || 12).map(function (it) {
      var v = it[valueKey];
      var label = it[labelKey];
      var pct = v == null ? 0 : Math.round((v / max) * 100);
      var display = opts.format ? opts.format(v) : PA.formatRate(v);
      return '<div class="pk-bar-row"><div class="pk-bar-lbl" title="' + escapeHtml(String(label)) + '">' +
        escapeHtml(String(label)) + '</div><div class="pk-bar-track" role="img" aria-label="' +
        escapeHtml(String(label) + ': ' + display) + '"><div class="pk-bar-fill' +
        (opts.tone ? ' ' + opts.tone : '') + '" style="width:' + pct + '%"></div></div><div class="pk-bar-val">' +
        escapeHtml(display) + '</div></div>';
    }).join('') + '</div>';
  }
  function columnChart(items, valueKey, labelFn) {
    if (!items.length) return '<div class="pk-empty-inline">No data for this chart</div>';
    var max = 1;
    items.forEach(function (it) { if (it[valueKey] != null && it[valueKey] > max) max = it[valueKey]; });
    return '<div class="pk-cols">' + items.map(function (it) {
      var v = it[valueKey] || 0;
      var h = Math.max(4, Math.round((v / max) * 100));
      var lbl = labelFn(it);
      return '<div class="pk-col"><div class="pk-col-bar" style="height:' + h + '%" title="' +
        escapeHtml(lbl + ': ' + PA.formatNumber(v)) + '"></div><div class="pk-col-lbl">' +
        escapeHtml(lbl) + '</div></div>';
    }).join('') + '</div>';
  }
  function chartCard(title, body) {
    return '<section class="pk-chart-card"><h3 class="pk-chart-title">' + escapeHtml(title) + '</h3>' + body + '</section>';
  }

  function buildWeekReport(weekKey, byDateSnap) {
    var days = [];
    var ws = startOfWeek(new Date(weekKey + 'T00:00:00'));
    for (var i = 0; i < 5; i++) {
      var dk = ymd(addDays(ws, i));
      var day = byDateSnap[dk] || {};
      ['morning', 'afternoon'].forEach(function (sk) {
        var b = day[sk];
        if (!b || !(b.records && b.records.length)) return;
        var workers = PA.aggregateWorkers(b.records);
        var skus = PA.aggregateSkus(b.records);
        var hourly = PA.aggregateByHour(b.records);
        days.push({
          date: dk,
          shift: sk,
          shiftLabel: shiftLabel(sk),
          kpis: PA.aggregateKpis(b.records),
          workers: workers,
          skus: skus,
          hourly: hourly,
          files: (b.files || []).map(function (f) {
            return { name: f.name, uploadedAt: f.uploadedAt, rowCount: f.rowCount, format: f.format };
          }),
          hourlyCsv: toHourlyCsv(workers, hourly),
          skuCsv: toSkuCsv(skus, b.records)
        });
      });
    }
    return {
      type: 'packer-week-export',
      schemaVersion: 1,
      weekKey: weekKey,
      exportedAt: new Date().toISOString(),
      days: days
    };
  }
  function toHourlyCsv(workers, hourly) {
    var hours = (hourly || []).map(function (h) { return h.hour; });
    var hdr = ['Worker', 'Boxes'].concat(hours.map(function (h) { return PA.formatHourLabel(h); }));
    var rows = (workers || []).map(function (w) {
      return [w.workerName, w.boxes].concat(hours.map(function (h) {
        return w.hours && w.hours[h] != null ? w.hours[h] : '';
      }));
    });
    return [hdr].concat(rows).map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
  }
  function toSkuCsv(skus, records) {
    var workers = PA.aggregateWorkers(records || []);
    var hdr = ['Worker', 'SKU', 'Boxes', 'Boxes/hour', 'Target', 'Efficiency', 'Status'];
    var rows = [];
    workers.forEach(function (w) {
      Object.keys(w.skus || {}).forEach(function (sku) {
        var t = PA.SKU_TARGETS[sku];
        var recs = (records || []).filter(function (r) { return r.workerKey === w.workerKey && r.sku === sku; });
        var boxes = recs.reduce(function (a, r) { return a + (r.boxes || 0); }, 0);
        var hours = recs.reduce(function (a, r) { return a + (r.packingHours || 0); }, 0);
        var bph = PA.boxesPerHour(boxes, hours > 0 ? hours : null);
        var eff = PA.efficiencyVersusTarget(bph, t ? t.target : null);
        var st = PA.performanceStatus(eff);
        rows.push([w.workerName, sku, boxes, bph != null ? bph.toFixed(1) : 'N/A', t ? t.target : '', eff != null ? (eff * 100).toFixed(1) + '%' : 'N/A', st.label]);
      });
    });
    if (!rows.length) {
      (skus || []).forEach(function (s) {
        rows.push(['(all)', s.label, s.boxes, s.boxesPerHour != null ? s.boxesPerHour.toFixed(1) : 'N/A', '', '', '']);
      });
    }
    return [hdr].concat(rows).map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
  }

  function csvEscapeRow(r) {
    return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }

  /** Weekly review: dates + boxes packed per SKU (and per worker). */
  function buildWeeklySkuReview(byDateSnap, weekKey) {
    var BOARD_SKUS = ['125', '150', '200', '250', '300', '400', '500', '600', '700'];
    var ws = startOfWeek(new Date(weekKey + 'T00:00:00'));
    var summaryRows = [];
    var detailRows = [];
    var usedSkus = {};
    var weekSkuTotals = {};
    BOARD_SKUS.forEach(function (s) { weekSkuTotals[s] = 0; });

    for (var i = 0; i < 5; i++) {
      var dk = ymd(addDays(ws, i));
      var day = byDateSnap[dk] || {};
      ['morning', 'afternoon'].forEach(function (sk) {
        var b = day[sk];
        if (!b || !(b.records && b.records.length)) return;
        var skuTotals = {};
        var workerSku = {};
        (b.records || []).forEach(function (r) {
          if (!r || !r.sku || !r.boxes) return;
          // Prefer Boxes Packed rows (have packing time). Skip pure Intra Hour.
          if (r.hour != null && (r.packingHours == null || r.packingHours <= 0)) return;
          skuTotals[r.sku] = (skuTotals[r.sku] || 0) + (r.boxes || 0);
          usedSkus[r.sku] = true;
          weekSkuTotals[r.sku] = (weekSkuTotals[r.sku] || 0) + (r.boxes || 0);
          var wk = r.workerKey || r.workerName || '';
          if (!wk) return;
          if (!workerSku[wk]) workerSku[wk] = { name: r.workerName || wk, skus: {} };
          workerSku[wk].skus[r.sku] = (workerSku[wk].skus[r.sku] || 0) + (r.boxes || 0);
        });
        var skuKeys = Object.keys(skuTotals);
        if (!skuKeys.length) return;
        var rowTotal = skuKeys.reduce(function (n, s) { return n + skuTotals[s]; }, 0);
        var sumLine = [PA.formatDateAU(dk), shiftLabel(sk)];
        BOARD_SKUS.forEach(function (s) { sumLine.push(skuTotals[s] || ''); });
        sumLine.push(rowTotal);
        var other = skuKeys.filter(function (s) { return BOARD_SKUS.indexOf(s) === -1; })
          .sort(function (a, b) { return Number(a) - Number(b); })
          .map(function (s) { return s + ':' + skuTotals[s]; }).join('; ');
        sumLine.push(other);
        summaryRows.push(sumLine);

        Object.keys(workerSku).sort(function (a, b) {
          return (workerSku[a].name || '').localeCompare(workerSku[b].name || '');
        }).forEach(function (wk) {
          var w = workerSku[wk];
          Object.keys(w.skus).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (sku) {
            detailRows.push([PA.formatDateAU(dk), shiftLabel(sk), w.name, sku, w.skus[sku]]);
          });
        });
      });
    }

    var skuCols = BOARD_SKUS.slice();
    var summaryHdr = ['Date', 'Shift'].concat(skuCols).concat(['Total', 'Other SKUs']);
    var weekTotalLine = ['WEEK TOTAL', ''];
    var weekAll = 0;
    skuCols.forEach(function (s) {
      weekTotalLine.push(weekSkuTotals[s] || '');
      weekAll += weekSkuTotals[s] || 0;
    });
    weekTotalLine.push(weekAll);
    weekTotalLine.push('');
    if (summaryRows.length) summaryRows.push(weekTotalLine);

    var summaryCsv = [summaryHdr].concat(summaryRows).map(csvEscapeRow).join('\n');
    var detailCsv = [['Date', 'Shift', 'Worker', 'SKU', 'Boxes Packed']]
      .concat(detailRows).map(csvEscapeRow).join('\n');

    return {
      weekKey: weekKey,
      hasData: summaryRows.length > 0,
      summaryCsv: summaryCsv,
      detailCsv: detailCsv,
      dayCount: summaryRows.length ? summaryRows.length - 1 : 0,
      boardSkus: skuCols,
      summaryRows: summaryRows,
      detailRows: detailRows
    };
  }

  function downloadWeeklySkuReview(byDateSnap, weekKey, force) {
    var review = buildWeeklySkuReview(byDateSnap || {}, weekKey);
    if (!review.hasData && !force) return { ok: false, review: review };
    var ok1 = downloadTextFile(
      'weekly-review-' + weekKey + '-skus.csv',
      review.summaryCsv,
      'text/csv'
    );
    var ok2 = true;
    if (review.hasData) {
      ok2 = downloadTextFile(
        'weekly-review-' + weekKey + '-by-worker.csv',
        review.detailCsv,
        'text/csv'
      );
    }
    return { ok: !!(ok1 && ok2), review: review };
  }

  /** Export the selected day/shift only: list of packers + SKUs + boxes. */
  function exportCurrentShiftPackers() {
    var dateKey = activeDateKey();
    var sk = state.rosterShift === 'afternoon' ? 'afternoon' : 'morning';
    var rows = PA.aggregatePeopleRows(currentRecords());
    if (!rows.length) {
      toast('No packers for ' + DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(sk), 'err');
      return false;
    }
    var hdr = ['Date', 'Shift', 'Worker', 'SKUs', 'Boxes', 'Hours', 'BPH', 'Status'];
    var body = rows.map(function (r) {
      var skus = (r.skus || []).map(function (s) { return s.sku; }).filter(Boolean).join(', ');
      var hrs = r.intraHours > 0 ? r.shiftHours : r.packingHours;
      return [
        PA.formatDateAU(dateKey),
        shiftLabel(sk),
        r.workerName,
        skus,
        r.boxes,
        hrs != null ? Number(hrs).toFixed(2) : '',
        r.boxesPerHour != null ? Number(r.boxesPerHour).toFixed(1) : '',
        r.strikeStatus ? r.strikeStatus.label : ''
      ];
    });
    var csv = [hdr].concat(body).map(csvEscapeRow).join('\n');
    var ok = downloadTextFile(
      'packer-' + dateKey + '-' + sk + '.csv',
      csv,
      'text/csv'
    );
    if (ok) toast('Exported ' + rows.length + ' packers · ' + shiftLabel(sk));
    return ok;
  }

  function exportActiveWeek(force) {
    // Packer Export = this day/shift packer list (not multi-file week dump).
    return exportCurrentShiftPackers();
  }

  function ensureCurrentWeekFresh() {
    var current = startOfWeek(new Date());
    var currentKey = ymd(current);
    if (state.activeWeekKey && state.activeWeekKey !== currentKey) {
      var oldKey = state.activeWeekKey;
      var snap = JSON.parse(JSON.stringify(state.byDate || {}));
      var hasData = Object.keys(snap).some(function (dk) {
        var day = snap[dk] || {};
        return ['morning', 'afternoon'].some(function (sk) {
          return day[sk] && day[sk].records && day[sk].records.length;
        });
      });
      if (hasData) {
        var report = buildWeekReport(oldKey, snap);
        var weekly = downloadWeeklySkuReview(snap, oldKey, true);
        var ok = downloadTextFile('packer-week-' + oldKey + '.json', JSON.stringify(report, null, 2), 'application/json');
        if (!ok && !(weekly && weekly.ok)) {
          state.error = 'Could not export last week’s Packer data — keeping it so nothing is cleared.';
          toast(state.error, 'err');
          return;
        }
        if (!state.archives) state.archives = {};
        state.archives[oldKey] = { weekKey: oldKey, byDate: snap, archivedAt: Date.now(), report: report };
        var aks = Object.keys(state.archives).sort();
        while (aks.length > 12) { delete state.archives[aks[0]]; aks.shift(); }
      }
      state.byDate = {};
      state.activeWeekKey = currentKey;
      state.weekStart = current;
      saveData();
      if (hasData) toast('New week — exported & archived Packer week of ' + oldKey);
    } else if (!state.activeWeekKey) {
      state.activeWeekKey = currentKey;
      state.weekStart = current;
    }
  }

  function renderChrome() {
    if (!state.weekStart) state.weekStart = startOfWeek(new Date());
    if (els.weekLabel) {
      els.weekLabel.innerHTML = weekLabel(state.weekStart) + '<span>' +
        shiftLabel(state.rosterShift) + '</span>';
    }
    if (els.shiftToggle) {
      Array.prototype.forEach.call(els.shiftToggle.querySelectorAll('button[data-shift]'), function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-shift') === state.rosterShift);
      });
    }
    if (els.daysEl) {
      var today = ymd(new Date());
      els.daysEl.innerHTML = '';
      for (var i = 0; i < 5; i++) {
        var d = addDays(state.weekStart, i);
        var key = ymd(d);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pk-day' + (i === state.dayIdx ? ' active' : '') + (key === today ? ' today' : '');
        var bucket = ensureBucket(key, state.rosterShift === 'afternoon' ? 'afternoon' : 'morning');
        var n = (bucket.records || []).length;
        btn.innerHTML = '<span class="d">' + DAY_NAMES[i] + '</span><span class="n">' + d.getDate() +
          (n ? ' · ' + n : '') + '</span>';
        btn.addEventListener('click', (function (idx) {
          return function () {
            state.dayIdx = idx;
            state.showLegacy = false;
            state.page = 1;
            renderAll();
          };
        })(i));
        els.daysEl.appendChild(btn);
      }
    }
  }

  function renderStatus() {
    if (!els.status) return;
    if (state.loading) {
      els.status.innerHTML = '<div class="pk-banner pk-banner-load">Loading CSV data…</div>';
      return;
    }
    if (state.error) {
      els.status.innerHTML = '<div class="pk-banner pk-banner-err" role="alert">' + escapeHtml(state.error) + '</div>';
      return;
    }
    if (!currentRecords().length) {
      els.status.innerHTML = '<div class="pk-banner">No data for ' +
        escapeHtml(DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(state.rosterShift)) +
        '. End of shift: upload <b>Boxes Packed by Worker</b> and <b>Intra Hour</b> CSVs. ' +
        'Same names are merged; SKU chips stay per-SKU, Status uses average BPH.</div>';
      return;
    }
    els.status.innerHTML = '';
  }

  function renderFilters() {
    if (els.searchInput && els.searchInput.value !== (state.filters.search || '')) {
      els.searchInput.value = state.filters.search || '';
    }
  }

  function renderKpis() {
    if (!els.kpis) return;
    if (!currentRecords().length) { els.kpis.innerHTML = ''; return; }
    var rows = peopleRowsFiltered();
    var counts = { on: 0, below: 0, strike: 0, none: 0 };
    rows.forEach(function (r) {
      if (r.strikeStatus && counts[r.strikeStatus.key] != null) counts[r.strikeStatus.key]++;
      else counts.none++;
    });
    var totalBoxes = rows.reduce(function (n, r) { return n + (r.boxes || 0); }, 0);
    var totalPackHrs = rows.reduce(function (n, r) { return n + (r.packingHours || 0); }, 0);
    var avgBph = totalPackHrs > 0 ? totalBoxes / totalPackHrs : null;
    var hourRows = filtered().filter(function (r) { return r.hour != null; });
    var hourSet = {};
    hourRows.forEach(function (r) { if (r.hour != null) hourSet[r.hour] = true; });
    var stats = [
      { cls: 'rate', num: PA.formatRate(avgBph), lbl: 'Avg BPH' },
      { cls: 'hours', num: PA.formatHours(totalPackHrs), lbl: 'Pack hrs' },
      { cls: 'on', num: String(counts.on), lbl: 'Hit target' },
      { cls: 'below', num: String(counts.below), lbl: 'Below tgt' },
      { cls: 'strike', num: String(counts.strike), lbl: 'Below strike' },
      { cls: 'boxes', num: PA.formatNumber(totalBoxes), lbl: 'Boxes' },
      { cls: '', num: String(rows.length), lbl: 'People' },
      { cls: '', num: String(Object.keys(hourSet).length), lbl: 'Slots' }
    ];
    els.kpis.innerHTML = stats.map(function (s) {
      return '<div class="pk-stat ' + s.cls + '"><div class="num">' + escapeHtml(s.num) +
        '</div><div class="lbl">' + escapeHtml(s.lbl) + '</div></div>';
    }).join('');
  }

  function applyView() {
    var v = state.view || 'people';
    if (v !== 'people' && v !== 'hours') v = 'people';
    state.view = v;
    if (els.tableWrap) els.tableWrap.hidden = false;
    if (els.charts) els.charts.hidden = true;
    if (els.quality) els.quality.hidden = true;
    if (els.views) {
      Array.prototype.forEach.call(els.views.querySelectorAll('button[data-view]'), function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-view') === v);
      });
    }
    renderTable();
  }

  function renderCharts() {
    if (els.charts) els.charts.innerHTML = '';
  }

  function skuListHtml(skus) {
    if (!skus || !skus.length) return '<span class="pk-muted">-</span>';
    return skus.map(function (s) {
      var st = s.strikeStatus || { key: 'none' };
      return '<span class="pk-sku-hit ' + escapeHtml(st.key) + '">' + escapeHtml(s.sku || '-') + '</span>';
    }).join('');
  }

  function renderPeopleTable() {
    var rows = peopleRowsFiltered();
    if (!rows.length) {
      var anyPeople = PA.aggregatePeopleRows(filtered()).length > 0;
      els.tableWrap.innerHTML = '<section class="pk-table-card"><div class="pk-banner">' +
        (anyPeople
          ? 'No people match the current SKU / status filter.'
          : 'No Boxes Packed by Worker rows for this day/shift. Upload that CSV for SKUs and BPH target.') +
        '</div></section>';
      return;
    }
    var page = PA.paginate(rows, state.page, PAGE_SIZE);
    var body = page.rows.map(function (r, i) {
      var hrsLbl = r.intraHours > 0
        ? PA.formatHours(r.shiftHours)
        : PA.formatHours(r.packingHours);
      return '<tr>' +
        '<td class="r mn">' + ((page.page - 1) * page.pageSize + i + 1) + '</td>' +
        '<td class="bold">' + escapeHtml(r.workerName) + '</td>' +
        '<td class="pk-sku-cell">' + skuListHtml(r.skus) + '</td>' +
        '<td class="r mn">' + escapeHtml(PA.formatNumber(r.boxes)) + '</td>' +
        '<td class="r mn">' + escapeHtml(hrsLbl) + '</td>' +
        '<td class="r mn">' + escapeHtml(PA.formatRate(r.boxesPerHour)) + '</td>' +
        '<td>' + strikePill(r.strikeStatus) + '</td></tr>';
    }).join('');
    var filterBits = [];
    if (state.filters.sku) filterBits.push('SKU ' + state.filters.sku);
    if (state.filters.status) filterBits.push(state.filters.status === 'on' ? 'Hit' : (state.filters.status === 'below' ? 'Below' : 'Strike'));
    els.tableWrap.innerHTML =
      '<section class="pk-table-card"><div class="pk-table-hdr"><h2 class="pk-section-title">People</h2>' +
      '<div class="pk-table-meta">' + escapeHtml(DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(state.rosterShift)) +
      ' · status = avg BPH' +
      (filterBits.length ? ' · ' + escapeHtml(filterBits.join(' · ')) : '') +
      '</div></div>' +
      '<div class="pk-tw"><table><thead><tr>' +
      '<th class="r">#</th><th>Worker</th><th>SKUs</th><th class="r">Boxes</th><th class="r">Hours</th>' +
      '<th class="r">BPH</th><th>Status</th>' +
      '</tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="empty-td">No people rows</td></tr>') +
      '</tbody></table></div><div class="pk-pager">' +
      '<button type="button" class="btn" data-page="prev"' + (page.page <= 1 ? ' disabled' : '') + '>Prev</button>' +
      '<span>' + page.page + ' / ' + page.pages + '</span>' +
      '<button type="button" class="btn" data-page="next"' + (page.page >= page.pages ? ' disabled' : '') + '>Next</button></div></section>';
    Array.prototype.forEach.call(els.tableWrap.querySelectorAll('[data-page]'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        state.page += btn.getAttribute('data-page') === 'next' ? 1 : -1;
        renderTable();
      });
    });
  }

  function renderHourlyTable() {
    var hourRecs = filtered().filter(function (r) { return r.hour != null; });
    if (!hourRecs.length) {
      els.tableWrap.innerHTML = '<section class="pk-table-card"><div class="pk-banner">No Intra Hour rows for this day/shift. Upload Intra Hour Floor Performance CSV(s).</div></section>';
      return;
    }
    var byHour = PA.aggregateByHour(hourRecs);
    var hourKeys = byHour.map(function (h) { return h.hour; });
    var head = hourKeys.map(function (h) { return '<th class="r">' + escapeHtml(PA.formatHourLabel(h)) + '</th>'; }).join('');
    var map = {};
    hourRecs.forEach(function (r) {
      if (r.hour == null || !r.workerKey) return;
      if (!map[r.workerKey]) map[r.workerKey] = { name: r.workerName, hours: {}, total: 0 };
      map[r.workerKey].hours[r.hour] = (map[r.workerKey].hours[r.hour] || 0) + (r.boxes || 0);
      map[r.workerKey].total += r.boxes || 0;
    });
    var names = Object.keys(map).sort(function (a, b) { return map[b].total - map[a].total; });
    var body = names.map(function (wk) {
      var w = map[wk];
      var cells = hourKeys.map(function (h) {
        var v = w.hours[h];
        return '<td class="r mn">' + (v != null ? v : '—') + '</td>';
      }).join('');
      return '<tr><td class="bold">' + escapeHtml(w.name) + '</td>' + cells +
        '<td class="r mn bold">' + w.total + '</td></tr>';
    }).join('');
    els.tableWrap.innerHTML =
      '<section class="pk-table-card"><div class="pk-table-hdr"><h2 class="pk-section-title">Hours</h2>' +
      '<div class="pk-table-meta">' + names.length + ' workers · ' + hourKeys.length + ' hour(s)</div></div>' +
      chartCard('Boxes by hour', columnChart(byHour, 'boxes', function (it) { return PA.formatHourLabel(it.hour); })) +
      '<div class="pk-tw" style="margin-top:8px"><table><thead><tr><th>Worker</th>' + head +
      '<th class="r">Total</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }

  function renderTable() {
    if (!els.tableWrap) return;
    if (!currentRecords().length) { els.tableWrap.innerHTML = ''; return; }
    if (state.view === 'hours') renderHourlyTable();
    else renderPeopleTable();
  }

  function renderDetail() {
    if (!els.detail) return;
    if (!state.selectedWorker) { els.detail.innerHTML = ''; els.detail.hidden = true; return; }
    var detail = PA.workerDetail(filtered(), state.selectedWorker);
    if (!detail.summary) { els.detail.innerHTML = ''; els.detail.hidden = true; return; }
    var s = detail.summary;
    els.detail.hidden = false;
    var trend = detail.daily.length > 1
      ? columnChart(detail.daily, 'boxes', function (it) { return it.date === 'unknown' ? '?' : PA.formatDateAU(it.date); })
      : '<div class="pk-empty-inline">Trend needs multiple report dates</div>';
    els.detail.innerHTML =
      '<div class="pk-detail-panel"><div class="pk-detail-hdr"><div><h2 class="pk-section-title">' +
      escapeHtml(s.workerName) + '</h2></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pkDetailClose">Close</button></div>' +
      '<div class="pk-detail-kpis">' +
      detailMetric('Boxes', PA.formatNumber(s.boxes)) +
      detailMetric('Packing hours', PA.formatHours(s.packingHours)) +
      detailMetric('Boxes / hour', PA.formatRate(s.boxesPerHour)) +
      detailMetric('Idle %', PA.formatPercent(s.idlePercentage)) +
      detailMetric('Efficiency', PA.formatPercent(s.efficiency)) +
      '</div><div class="pk-detail-grid"><section><h3 class="pk-chart-title">Daily trend</h3>' + trend +
      '</section><section><h3 class="pk-chart-title">Hourly boxes</h3>' +
      columnChart(detail.hourly, 'boxes', function (it) { return PA.formatHourLabel(it.hour); }) +
      '</section><section><h3 class="pk-chart-title">Station history</h3>' +
      barChart(detail.stations, 'boxes', 'label', { format: PA.formatNumber, tone: 'tone-b' }) +
      '</section><section><h3 class="pk-chart-title">SKU performance</h3>' +
      barChart(detail.skus, 'boxesPerHour', 'label', { format: PA.formatRate, tone: 'tone-g' }) +
      '</section></div></div>';
    var close = document.getElementById('pkDetailClose');
    if (close) close.addEventListener('click', function () { state.selectedWorker = null; renderDetail(); });
  }
  function detailMetric(label, value) {
    return '<div class="pk-detail-metric"><div class="pk-kpi-l">' + escapeHtml(label) +
      '</div><div class="pk-kpi-v" style="font-size:1.15rem">' + escapeHtml(value) + '</div></div>';
  }

  function renderQuality() {
    if (!els.quality) return;
    var files = currentFiles();
    var q = PA.summarizeQuality(currentRecords(), currentQuality());
    if (!currentRecords().length && !files.length) { els.quality.innerHTML = ''; return; }
    var items = [
      ['Valid rows', q.validRows], ['Invalid rows', q.invalidRows],
      ['Missing worker names', q.missingWorkerNames], ['Missing dates', q.missingDates],
      ['Missing packing time', q.missingPackingTime], ['Duplicate rows skipped', q.duplicateRows],
      ['Unknown shifts', q.unknownShifts], ['Failed calculated fields', q.failedCalculations],
      ['Files (raw kept)', files.length]
    ];
    els.quality.innerHTML = '<section class="pk-quality"><h2 class="pk-section-title">Data quality</h2>' +
      '<div class="pk-quality-grid">' + items.map(function (it) {
        return '<div class="pk-quality-item"><div class="pk-kpi-v" style="font-size:1.1rem">' +
          escapeHtml(PA.formatNumber(it[1])) + '</div><div class="pk-kpi-l">' + escapeHtml(it[0]) + '</div></div>';
      }).join('') + '</div><div class="pk-file-list">' + files.map(function (f) {
        return '<div class="pk-file-chip" title="Raw CSV preserved">' + escapeHtml(f.name) +
          ' · ' + (f.rowCount != null ? f.rowCount + ' rows · ' : '') +
          escapeHtml(new Date(f.uploadedAt).toLocaleString('en-AU')) + '</div>';
      }).join('') + '</div></section>';
  }

  function renderPreview() {
    if (!els.preview) return;
    var p = state.pendingImport;
    if (!p) { els.preview.hidden = true; els.preview.innerHTML = ''; return; }
    els.preview.hidden = false;
    var plan = summarizeImportPlan(p.files, p.fallbackDate, p.fallbackShift);
    var routeBlocks = plan.buckets.length
      ? '<div class="pk-preview-file"><strong>Will save into</strong><div class="pk-table-meta">' +
        plan.buckets.map(function (b) {
          var existing = (ensureBucket(b.date, b.shift).records || []).length;
          return escapeHtml(PA.formatDateAU(b.date) + ' · ' + shiftLabel(b.shift)) +
            ': ' + b.count + ' row(s)' +
            (existing ? ' (already has ' + existing + ')' : '');
        }).join('<br>') +
        '</div></div>'
      : '<div class="pk-banner pk-banner-load">No report dates found in the CSV — rows will use the day you’re viewing (' +
        escapeHtml(PA.formatDateAU(p.fallbackDate) + ' · ' + shiftLabel(p.fallbackShift)) + ').</div>';
    var existingTotal = plan.buckets.reduce(function (n, b) {
      return n + ((ensureBucket(b.date, b.shift).records || []).length);
    }, 0);
    var fileBlocks = p.files.map(function (f) {
      var r = f.result;
      if (!r.ok) {
        return '<div class="pk-preview-file err"><strong>' + escapeHtml(f.name) + '</strong><br>' +
          escapeHtml(r.error || 'Invalid') + '</div>';
      }
      var q = r.quality || {};
      var label = r.format === 'hourly' ? 'Intra Hour'
        : (r.format === 'summary' ? 'Boxes Packed by Worker' : (r.format || '?'));
      return '<div class="pk-preview-file"><strong>' + escapeHtml(f.name) + '</strong>' +
        '<div class="pk-table-meta">' + escapeHtml(label) +
        ' · ' + r.records.length + ' usable row(s)' +
        (q.invalidRows ? ' · ' + q.invalidRows + ' invalid' : '') +
        (q.duplicateRows ? ' · ' + q.duplicateRows + ' dupes in file' : '') +
        (q.totalsRowsSkipped ? ' · ' + q.totalsRowsSkipped + ' totals skipped' : '') +
        (q.missingWorkerNames ? ' · ' + q.missingWorkerNames + ' missing names' : '') +
        '</div></div>';
    }).join('');
    var anyOk = p.files.some(function (f) { return f.result && f.result.ok; });
    els.preview.innerHTML =
      '<div class="pk-preview-card" role="dialog" aria-label="Import preview">' +
      '<h2 class="pk-section-title">Import preview</h2>' +
      '<div class="pk-table-meta" style="margin-bottom:8px">Day and Afternoon come from each CSV row — not from the tab you’re on.</div>' +
      '<div class="pk-preview-targets">' +
      '<label class="pk-fl"><span>If data already exists</span><select id="pkPreviewMode">' +
      '<option value="merge"' + (p.mode !== 'replace' ? ' selected' : '') + '>Merge (skip duplicates)</option>' +
      '<option value="replace"' + (p.mode === 'replace' ? ' selected' : '') + '>Replace those day/shifts</option>' +
      '</select></label></div>' +
      (existingTotal ? '<div class="pk-banner pk-banner-load">Some of those day/shifts already have data. Choose Merge or Replace above.</div>' : '') +
      routeBlocks + fileBlocks +
      '<div class="pk-preview-actions">' +
      '<button type="button" class="btn btn-ghost" id="pkPreviewCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="pkPreviewImport"' + (anyOk ? '' : ' disabled') + '>Import</button>' +
      '</div></div>';
    document.getElementById('pkPreviewCancel').addEventListener('click', function () {
      state.pendingImport = null; renderPreview();
      if (els.fileInput) els.fileInput.value = '';
    });
    document.getElementById('pkPreviewImport').addEventListener('click', function () {
      p.mode = document.getElementById('pkPreviewMode').value;
      commitPendingImport();
    });
  }

  async function commitPendingImport() {
    var p = state.pendingImport;
    if (!p) return;
    var messages = [];
    var anyOk = false;
    var touched = {};
    var formats = {};
    var jumpDate = p.fallbackDate;
    var jumpShift = p.fallbackShift;
    var jumpCount = 0;

    p.files.forEach(function (f) {
      var res = f.result;
      if (!res || !res.ok) {
        messages.push(f.name + ': ' + (res && res.error ? res.error : 'failed'));
        return;
      }
      if (res.format) formats[res.format] = (formats[res.format] || 0) + 1;
      var groups = groupImportRecords(res.records, p.fallbackDate, p.fallbackShift);
      var keys = Object.keys(groups);
      if (!keys.length) {
        messages.push(f.name + ': no rows with a usable date');
        return;
      }
      var fileDupes = 0;
      var fileAdded = 0;
      keys.forEach(function (k) {
        var g = groups[k];
        var bucket = ensureBucket(g.date, g.shift);
        touched[k] = { date: g.date, shift: g.shift };
        if (p.mode === 'replace' && !bucket._replacedThisImport) {
          bucket.records = [];
          bucket.files = [];
          bucket.quality = PA.emptyQuality();
          bucket._replacedThisImport = true;
        }
        var before = bucket.records.length;
        var merged = PA.mergeRecords(bucket.records, g.records);
        var cross = before + g.records.length - merged.records.length;
        fileDupes += Math.max(0, cross);
        fileAdded += merged.records.length - before;
        bucket.records = merged.records;
        bucket.quality = PA.mergeQuality(bucket.quality, res.quality);
        bucket.files.push({
          id: uid(),
          name: f.name,
          uploadedAt: Date.now(),
          text: res.rawText,
          rowCount: g.records.length,
          format: res.format,
          quality: res.quality
        });
        if (g.records.length > jumpCount) {
          jumpCount = g.records.length;
          jumpDate = g.date;
          jumpShift = g.shift;
        }
      });
      anyOk = true;
      messages.push(f.name + ': ' + fileAdded + ' row(s) into ' + keys.length + ' slot(s)' +
        (fileDupes ? ', ' + fileDupes + ' dupes skipped' : ''));
    });

    Object.keys(touched).forEach(function (k) {
      var t = touched[k];
      var b = ensureBucket(t.date, t.shift);
      delete b._replacedThisImport;
    });

    state.pendingImport = null;
    state.showLegacy = false;
    state.view = preferViewFromFormats(formats);
    state.rosterShift = jumpShift === 'afternoon' ? 'afternoon' : 'morning';
    var ws = startOfWeek(new Date(jumpDate + 'T00:00:00'));
    state.weekStart = ws;
    state.activeWeekKey = ymd(ws);
    state.dayIdx = 0;
    for (var i = 0; i < 5; i++) {
      if (ymd(addDays(ws, i)) === jumpDate) { state.dayIdx = i; break; }
    }
    var saved = true;
    if (anyOk) saved = await saveData();
    if (!saved) messages.push('Could not save — data may be lost on refresh');
    renderPreview();
    renderAll();
    toast(messages.join(' · ') || 'Nothing imported', anyOk && saved ? undefined : 'err');
    if (els.fileInput) els.fileInput.value = '';
  }

  function renderAll() {
    ensureCurrentWeekFresh();
    renderChrome();
    renderStatus();
    renderFilters();
    renderChipBar();
    renderKpis();
    renderCharts();
    renderTable();
    renderDetail();
    renderQuality();
    renderPreview();
    applyView();
    updateHeader();
  }
  function updateHeader() {
    if (!els.lastUpdated) return;
    var recs = currentRecords();
    var files = currentFiles();
    if (!recs.length && !files.length) {
      els.lastUpdated.textContent = DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(state.rosterShift);
      return;
    }
    els.lastUpdated.textContent = DAY_NAMES[state.dayIdx] + ' · ' + recs.length + ' rows';
  }

  async function saveData() {
    try {
      state.revision = (state.revision || 0) + 1;
      var payload = {
        schemaVersion: 1,
        revision: state.revision,
        version: 3,
        activeWeekKey: state.activeWeekKey || ymd(state.weekStart || startOfWeek(new Date())),
        byDate: state.byDate,
        archives: state.archives || {},
        legacy: state.legacy || { records: [], files: [], quality: PA.emptyQuality() },
        updatedAt: Date.now()
      };
      await window.storage.set(STORAGE_KEY, JSON.stringify(payload), false);
      return true;
    } catch (e) {
      console.error('packer save failed', e);
      return false;
    }
  }

  function migrateV2ToV3(data) {
    // Preserve all prior flat records in legacy — never drop.
    var legacyRecords = data.records || [];
    var legacyFiles = data.files || [];
    var legacyQuality = data.quality || PA.emptyQuality();
    var byDate = {};
    // Also place rows with a reportDate into the matching calendar bucket when possible.
    legacyRecords.forEach(function (rec) {
      if (!rec || !rec.reportDate) return;
      var sk = 'morning';
      if (rec.shiftKey && /afternoon|evening|night/i.test(rec.shiftKey)) sk = 'afternoon';
      else if (rec.shiftKey && /morning|day/i.test(rec.shiftKey)) sk = 'morning';
      var b = ensureBucketIn(byDate, rec.reportDate, sk);
      b.records.push(rec);
    });
    return {
      byDate: byDate,
      legacy: { records: legacyRecords, files: legacyFiles, quality: legacyQuality }
    };
  }
  function ensureBucketIn(byDate, dateKey, shiftKey) {
    if (!byDate[dateKey]) byDate[dateKey] = {};
    if (!byDate[dateKey][shiftKey]) byDate[dateKey][shiftKey] = emptyBucket();
    return byDate[dateKey][shiftKey];
  }

  async function loadAll() {
    state.loading = true;
    state.weekStart = startOfWeek(new Date());
    state.dayIdx = Math.min(4, Math.max(0, (new Date().getDay() + 6) % 7));
    state.activeWeekKey = ymd(state.weekStart);
    renderStatus();
    try {
      var r = await window.storage.get(STORAGE_KEY, false);
      if (r && r.value) {
        var data = JSON.parse(r.value);
        if (data && data.version === 3 && data.byDate) {
          state.byDate = data.byDate || {};
          state.archives = data.archives || {};
          state.legacy = data.legacy || { records: [], files: [], quality: PA.emptyQuality() };
          state.activeWeekKey = data.activeWeekKey || state.activeWeekKey;
          state.revision = data.revision || 0;
          // Rebuild rows from raw CSV text so names keep original casing after parser fixes.
          if (rebuildBucketsFromRawFiles(state.byDate)) {
            await saveData();
          }
        } else if (data && data.version === 2 && Array.isArray(data.records)) {
          var m = migrateV2ToV3(data);
          state.byDate = m.byDate;
          state.legacy = m.legacy;
          await saveData();
          toast('Migrated previous Packer data into calendar days');
        } else if (data && typeof data === 'object') {
          // Very old shift-keyed object
          var legacyRecs = PA.migrateLegacyShifts(data);
          state.legacy = { records: legacyRecs, files: [], quality: PA.summarizeQuality(legacyRecs, null) };
          state.byDate = {};
          await saveData();
          toast('Migrated older Packer data into calendar days');
        }
      }
    } catch (e) {
      console.error(e);
      state.error = 'Could not read saved Packer data — showing empty day so nothing is overwritten.';
      toast(state.error, 'err');
    }
    state.loading = false;
    ensureCurrentWeekFresh();
    renderAll();
  }

  /** Re-parse preserved raw CSV files so worker names use current casing rules. */
  function rebuildBucketsFromRawFiles(byDate) {
    var changed = false;
    Object.keys(byDate || {}).forEach(function (dk) {
      Object.keys(byDate[dk] || {}).forEach(function (sk) {
        var bucket = byDate[dk][sk];
        if (!bucket || !bucket.files || !bucket.files.length) return;
        var rebuilt = [];
        var quality = PA.emptyQuality();
        var anyRaw = false;
        bucket.files.forEach(function (f) {
          if (!f || !f.text) return;
          anyRaw = true;
          var res = PA.processCsvText(f.text, {
            sourceFile: f.name || 'saved.csv',
            defaultShift: sk === 'afternoon' ? 'afternoon_shift' : 'morning_shift'
          });
          if (!res.ok) return;
          // Keep only rows that belong in this calendar slot
          var kept = res.records.filter(function (rec) {
            var date = rec.reportDate || dk;
            var shift = rosterShiftFromRecord(rec, sk);
            return date === dk && shift === sk;
          });
          var merged = PA.mergeRecords(rebuilt, kept);
          rebuilt = merged.records;
          quality = PA.mergeQuality(quality, res.quality);
          f.rowCount = kept.length;
          f.format = res.format;
          f.quality = res.quality;
        });
        if (anyRaw) {
          var before = JSON.stringify((bucket.records || []).map(function (r) { return r.workerName; }));
          var after = JSON.stringify(rebuilt.map(function (r) { return r.workerName; }));
          bucket.records = rebuilt;
          bucket.quality = quality;
          if (before !== after) changed = true;
        }
      });
    });
    return changed;
  }

  async function stageFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    state.loading = true;
    state.error = null;
    renderStatus();
    var staged = [];
    for (var i = 0; i < files.length; i++) {
      try {
        var text = await files[i].text();
        var res = PA.processCsvText(text, {
          sourceFile: files[i].name,
          defaultShift: state.rosterShift === 'afternoon' ? 'afternoon_shift' : 'morning_shift'
        });
        staged.push({ name: files[i].name, text: text, result: res });
      } catch (err) {
        staged.push({ name: files[i].name, text: '', result: { ok: false, error: 'Failed to read file', records: [], quality: PA.emptyQuality() } });
      }
    }
    state.loading = false;
    state.pendingImport = {
      files: staged,
      fallbackDate: activeDateKey(),
      fallbackShift: state.rosterShift === 'afternoon' ? 'afternoon' : 'morning',
      mode: 'merge'
    };
    renderStatus();
    renderPreview();
  }

  var clearArmed = false, clearTimer = null;
  function resetClearBtn() {
    clearArmed = false;
    if (els.clearBtn) {
      els.clearBtn.textContent = 'Clear day';
      els.clearBtn.classList.remove('btn-danger-pending');
    }
  }

  if (els.uploadBtn && els.fileInput) {
    els.uploadBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', function (e) { stageFiles(e.target.files); });
  }
  if (els.clearBtn) {
    els.clearBtn.addEventListener('click', async function () {
      if (!clearArmed) {
        clearArmed = true;
        els.clearBtn.textContent = 'Confirm?';
        els.clearBtn.classList.add('btn-danger-pending');
        clearTimeout(clearTimer);
        clearTimer = setTimeout(resetClearBtn, 3000);
        return;
      }
      clearTimeout(clearTimer);
      resetClearBtn();
      var b = activeBucket();
      b.records = []; b.files = []; b.quality = PA.emptyQuality();
      await saveData();
      renderAll();
      toast('Cleared ' + DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(state.rosterShift));
    });
  }
  if (els.shiftToggle) {
    els.shiftToggle.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-shift]') : null;
      if (!btn) return;
      state.rosterShift = btn.getAttribute('data-shift');
      state.showLegacy = false;
      state.page = 1;
      renderAll();
    });
  }
  if (els.prevWeek) {
    els.prevWeek.addEventListener('click', function () {
      state.weekStart = addDays(state.weekStart, -7);
      state.activeWeekKey = ymd(state.weekStart);
      state.showLegacy = false;
      renderAll();
    });
  }
  if (els.nextWeek) {
    els.nextWeek.addEventListener('click', function () {
      state.weekStart = addDays(state.weekStart, 7);
      state.activeWeekKey = ymd(state.weekStart);
      state.showLegacy = false;
      renderAll();
    });
  }
  if (els.jumpToday) {
    els.jumpToday.addEventListener('click', function () {
      state.weekStart = startOfWeek(new Date());
      state.activeWeekKey = ymd(state.weekStart);
      state.dayIdx = Math.min(4, Math.max(0, (new Date().getDay() + 6) % 7));
      state.showLegacy = false;
      renderAll();
    });
  }
  if (els.weekLabel) {
    els.weekLabel.addEventListener('click', function () {
      if (els.jumpToday) els.jumpToday.click();
    });
  }
  if (els.searchInput) {
    els.searchInput.addEventListener('input', function () {
      state.filters.search = els.searchInput.value || '';
      state.page = 1;
      renderChipBar();
      renderKpis();
      renderTable();
      renderCharts();
      renderQuality();
    });
  }
  if (els.chipBar) {
    els.chipBar.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-filter]') : null;
      if (!btn) return;
      var key = btn.getAttribute('data-filter');
      var val = btn.getAttribute('data-value');
      if (!key) return;
      if (key === 'hour') state.filters.hour = val === '' ? '' : Number(val);
      else state.filters[key] = val || '';
      state.page = 1;
      renderChipBar();
      renderKpis();
      renderTable();
    });
  }
  if (els.views) {
    els.views.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
      if (!btn) return;
      state.view = btn.getAttribute('data-view') || 'people';
      state.page = 1;
      if (state.view === 'hours') state.filters.status = '';
      else state.filters.hour = '';
      renderChipBar();
      renderKpis();
      applyView();
    });
  }

  window.__packerDashboard = {
    refresh: renderAll,
    exportWeek: exportActiveWeek,
    exportShiftPackers: exportCurrentShiftPackers,
    buildWeeklySkuReview: buildWeeklySkuReview,
    downloadWeeklySkuReview: downloadWeeklySkuReview,
    getByDate: function () { return state.byDate; },
    getWeekStart: function () { return state.weekStart || startOfWeek(new Date()); }
  };
  loadAll();
})();
