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
      minPerformance: '',
      search: ''
    },
    sortKey: 'rankScore',
    sortDir: 'desc',
    page: 1,
    selectedWorker: null,
    loading: false,
    error: null,
    view: 'strike', // strike | hourly | quality
    pendingImport: null // { files: [{name,text,result}], targetDate, targetShift, mode }
  };

  var els = {
    lastUpdated: document.getElementById('pkLastUpdated'),
    fileInput: document.getElementById('pkFileInput'),
    uploadBtn: document.getElementById('pkUploadBtn'),
    clearBtn: document.getElementById('pkClearBtn'),
    exportWeekBtn: document.getElementById('pkExportWeekBtn'),
    shiftToggle: document.getElementById('pkShift'),
    daysEl: document.getElementById('pkDays'),
    weekLabel: document.getElementById('pkWeekLabel'),
    prevWeek: document.getElementById('pkPrevWeek'),
    nextWeek: document.getElementById('pkNextWeek'),
    jumpToday: document.getElementById('pkJumpToday'),
    legacyBtn: document.getElementById('pkLegacyBtn'),
    searchInput: document.getElementById('pkSearchInput'),
    views: document.getElementById('pkViews'),
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
    if (state.showLegacy) return state.legacy.records || [];
    return activeBucket().records || [];
  }
  function currentQuality() {
    if (state.showLegacy) return state.legacy.quality || PA.emptyQuality();
    return activeBucket().quality || PA.emptyQuality();
  }
  function currentFiles() {
    if (state.showLegacy) return state.legacy.files || [];
    return activeBucket().files || [];
  }
  function filtered() {
    return PA.filterRecords(currentRecords(), state.filters);
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

  function exportActiveWeek(force) {
    var weekKey = state.activeWeekKey || ymd(state.weekStart || startOfWeek(new Date()));
    var report = buildWeekReport(weekKey, state.byDate);
    if (!report.days.length && !force) {
      toast('No Packer data this week to export', 'err');
      return false;
    }
    var ok = downloadTextFile('packer-week-' + weekKey + '.json', JSON.stringify(report, null, 2), 'application/json');
    if (ok && report.days.length) {
      report.days.forEach(function (d) {
        if (d.hourlyCsv) downloadTextFile('packer-' + d.date + '-' + d.shift + '-hourly.csv', d.hourlyCsv, 'text/csv');
        if (d.skuCsv) downloadTextFile('packer-' + d.date + '-' + d.shift + '-sku.csv', d.skuCsv, 'text/csv');
      });
    }
    return ok;
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
        var ok = downloadTextFile('packer-week-' + oldKey + '.json', JSON.stringify(report, null, 2), 'application/json');
        if (!ok) {
          state.error = 'Could not export last week’s Packer data — keeping it so nothing is cleared.';
          toast(state.error, 'err');
          return;
        }
        report.days.forEach(function (d) {
          if (d.hourlyCsv) downloadTextFile('packer-' + d.date + '-' + d.shift + '-hourly.csv', d.hourlyCsv, 'text/csv');
          if (d.skuCsv) downloadTextFile('packer-' + d.date + '-' + d.shift + '-sku.csv', d.skuCsv, 'text/csv');
        });
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
        shiftLabel(state.rosterShift) + (state.showLegacy ? ' · Legacy' : '') + '</span>';
    }
    if (els.shiftToggle) {
      Array.prototype.forEach.call(els.shiftToggle.querySelectorAll('button[data-shift]'), function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-shift') === state.rosterShift && !state.showLegacy);
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
        btn.className = 'pk-day' + (i === state.dayIdx && !state.showLegacy ? ' active' : '') + (key === today ? ' today' : '');
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
    if (els.legacyBtn) {
      var ln = (state.legacy.records || []).length;
      els.legacyBtn.style.display = ln ? '' : 'none';
      els.legacyBtn.classList.toggle('active', state.showLegacy);
      els.legacyBtn.textContent = 'Legacy (' + ln + ')';
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
    if (state.showLegacy) {
      els.status.innerHTML = '<div class="pk-banner pk-banner-empty"><strong>Legacy imports</strong><br>' +
        'Data from before the Day/Afternoon × Mon–Fri calendar. Kept so nothing was dropped. ' +
        'New uploads go into the selected weekday.</div>';
      return;
    }
    if (!currentRecords().length) {
      els.status.innerHTML = '<div class="pk-banner">No data for ' +
        escapeHtml(DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(state.rosterShift)) +
        '. Upload your <b>raw</b> CSV (for strike check) and <b>hourly boxes</b> CSV — you’ll preview before save.</div>';
      return;
    }
    els.status.innerHTML = '';
  }

  function renderFilters() {
    // Search lives in chrome; advanced filters stay unused in the compact layout.
    if (els.searchInput && els.searchInput.value !== (state.filters.search || '')) {
      els.searchInput.value = state.filters.search || '';
    }
  }

  function renderKpis() {
    if (!els.kpis) return;
    if (!currentRecords().length) { els.kpis.innerHTML = ''; return; }
    var rows = PA.aggregateStrikeRows(filtered());
    var counts = { on: 0, below: 0, strike: 0, none: 0 };
    rows.forEach(function (r) {
      if (r.strikeStatus && counts[r.strikeStatus.key] != null) counts[r.strikeStatus.key]++;
      else counts.none++;
    });
    var k = PA.aggregateKpis(filtered());
    var stats = [
      { cls: 'on', num: String(counts.on), lbl: 'On target' },
      { cls: 'below', num: String(counts.below), lbl: 'Below tgt' },
      { cls: 'strike', num: String(counts.strike), lbl: 'Below strike' },
      { cls: 'boxes', num: PA.formatNumber(k.totalBoxes), lbl: 'Boxes' },
      { cls: '', num: PA.formatNumber(k.activeWorkers), lbl: 'People' }
    ];
    els.kpis.innerHTML = stats.map(function (s) {
      return '<div class="pk-stat ' + s.cls + '"><div class="num">' + escapeHtml(s.num) +
        '</div><div class="lbl">' + escapeHtml(s.lbl) + '</div></div>';
    }).join('');
  }

  function applyView() {
    var v = state.view || 'strike';
    if (els.tableWrap) els.tableWrap.hidden = v !== 'strike' && v !== 'hourly';
    if (els.charts) els.charts.hidden = true;
    if (els.quality) els.quality.hidden = v !== 'quality';
    if (els.views) {
      Array.prototype.forEach.call(els.views.querySelectorAll('button[data-view]'), function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-view') === v);
      });
    }
    if (v === 'strike' || v === 'hourly') renderTable();
  }

  function renderCharts() {
    if (els.charts) els.charts.innerHTML = '';
  }

  function renderStrikeTable() {
    var rows = PA.aggregateStrikeRows(filtered());
    // Prefer rows that have hours (raw/EOS) — hourly-only uploads won't have BPH
    var withHours = rows.filter(function (r) { return r.packingHours != null && r.packingHours > 0; });
    var list = withHours.length ? withHours : rows;
    var page = PA.paginate(list, state.page, PAGE_SIZE);
    var body = page.rows.map(function (r, i) {
      return '<tr>' +
        '<td class="r mn">' + ((page.page - 1) * page.pageSize + i + 1) + '</td>' +
        '<td class="bold">' + escapeHtml(r.workerName) + '</td>' +
        '<td>' + escapeHtml(r.sku) + '</td>' +
        '<td class="r mn">' + escapeHtml(PA.formatNumber(r.boxes)) + '</td>' +
        '<td class="r mn">' + escapeHtml(PA.formatRate(r.boxesPerHour)) + '</td>' +
        '<td class="r mn">' + escapeHtml(r.target != null ? String(r.target) : 'N/A') + '</td>' +
        '<td class="r mn">' + escapeHtml(r.strike != null ? String(r.strike) : 'N/A') + '</td>' +
        '<td>' + strikePill(r.strikeStatus) + '</td></tr>';
    }).join('');
    var note = withHours.length
      ? 'Boxes/hour vs SKU target & strike line'
      : 'Upload your raw CSV (with packing hours + SKU) for strike check. Hourly file alone can’t compute BPH.';
    els.tableWrap.innerHTML =
      '<section class="pk-table-card"><div class="pk-table-hdr"><h2 class="pk-section-title">Strike check</h2>' +
      '<div class="pk-table-meta">' + escapeHtml(note) + '</div></div>' +
      '<div class="pk-tw"><table><thead><tr>' +
      '<th class="r">#</th><th>Worker</th><th>SKU</th><th class="r">Boxes</th><th class="r">BPH</th>' +
      '<th class="r">Target</th><th class="r">Strike</th><th>Status</th>' +
      '</tr></thead><tbody>' +
      (body || '<tr><td colspan="8" class="empty-td">No strike rows yet — upload raw + hourly CSVs</td></tr>') +
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
    var byHour = PA.aggregateByHour(filtered());
    var workers = PA.aggregateWorkers(filtered());
    if (!byHour.length) {
      els.tableWrap.innerHTML = '<section class="pk-table-card"><div class="pk-banner">No hourly rows for this day. Upload the boxes-per-hour CSV.</div></section>';
      return;
    }
    var hourKeys = byHour.map(function (h) { return h.hour; });
    var head = hourKeys.map(function (h) { return '<th class="r">' + escapeHtml(PA.formatHourLabel(h)) + '</th>'; }).join('');
    // Rebuild per-worker hour map from records
    var map = {};
    filtered().forEach(function (r) {
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
      return '<tr><td>' + escapeHtml(w.name) + '</td>' + cells +
        '<td class="r mn bold">' + w.total + '</td></tr>';
    }).join('');
    els.tableWrap.innerHTML =
      '<section class="pk-table-card"><div class="pk-table-hdr"><h2 class="pk-section-title">Boxes / hour</h2>' +
      '<div class="pk-table-meta">' + names.length + ' workers</div></div>' +
      chartCard('Boxes by hour', columnChart(byHour, 'boxes', function (it) { return PA.formatHourLabel(it.hour); })) +
      '<div class="pk-tw" style="margin-top:8px"><table><thead><tr><th>Worker</th>' + head +
      '<th class="r">Total</th></tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }

  function renderTable() {
    if (!els.tableWrap) return;
    if (!currentRecords().length) { els.tableWrap.innerHTML = ''; return; }
    if (state.view === 'hourly') renderHourlyTable();
    else renderStrikeTable();
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
    var bucket = ensureBucket(p.targetDate, p.targetShift);
    var existing = (bucket.records || []).length;
    var fileBlocks = p.files.map(function (f, idx) {
      var r = f.result;
      if (!r.ok) {
        return '<div class="pk-preview-file err"><strong>' + escapeHtml(f.name) + '</strong><br>' +
          escapeHtml(r.error || 'Invalid') + '</div>';
      }
      var q = r.quality || {};
      return '<div class="pk-preview-file"><strong>' + escapeHtml(f.name) + '</strong>' +
        '<div class="pk-table-meta">Format: ' + escapeHtml(r.format || '?') +
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
      '<div class="pk-preview-targets">' +
      '<label class="pk-fl"><span>Day</span><select id="pkPreviewDate">' +
      dayOptionsHtml(p.targetDate) + '</select></label>' +
      '<label class="pk-fl"><span>Shift</span><select id="pkPreviewShift">' +
      '<option value="morning"' + (p.targetShift === 'morning' ? ' selected' : '') + '>Day</option>' +
      '<option value="afternoon"' + (p.targetShift === 'afternoon' ? ' selected' : '') + '>Afternoon</option>' +
      '</select></label>' +
      '<label class="pk-fl"><span>If data already exists</span><select id="pkPreviewMode">' +
      '<option value="merge"' + (p.mode !== 'replace' ? ' selected' : '') + '>Merge (skip duplicates)</option>' +
      '<option value="replace"' + (p.mode === 'replace' ? ' selected' : '') + '>Replace this day/shift</option>' +
      '</select></label></div>' +
      (existing ? '<div class="pk-banner pk-banner-load">This day/shift already has ' + existing +
        ' row(s). Choose Merge or Replace above.</div>' : '') +
      fileBlocks +
      '<div class="pk-preview-actions">' +
      '<button type="button" class="btn btn-ghost" id="pkPreviewCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="pkPreviewImport"' + (anyOk ? '' : ' disabled') + '>Import</button>' +
      '</div></div>';
    document.getElementById('pkPreviewCancel').addEventListener('click', function () {
      state.pendingImport = null; renderPreview();
      if (els.fileInput) els.fileInput.value = '';
    });
    document.getElementById('pkPreviewImport').addEventListener('click', function () {
      p.targetDate = document.getElementById('pkPreviewDate').value;
      p.targetShift = document.getElementById('pkPreviewShift').value;
      p.mode = document.getElementById('pkPreviewMode').value;
      commitPendingImport();
    });
  }
  function dayOptionsHtml(selected) {
    if (!state.weekStart) state.weekStart = startOfWeek(new Date());
    var html = '';
    for (var i = 0; i < 5; i++) {
      var d = addDays(state.weekStart, i);
      var key = ymd(d);
      html += '<option value="' + key + '"' + (key === selected ? ' selected' : '') + '>' +
        DAY_NAMES[i] + ' ' + PA.formatDateAU(key) + '</option>';
    }
    return html;
  }

  async function commitPendingImport() {
    var p = state.pendingImport;
    if (!p) return;
    var bucket = ensureBucket(p.targetDate, p.targetShift);
    var messages = [];
    var anyOk = false;
    if (p.mode === 'replace') {
      bucket.records = [];
      bucket.files = [];
      bucket.quality = PA.emptyQuality();
    }
    p.files.forEach(function (f) {
      var res = f.result;
      if (!res || !res.ok) {
        messages.push(f.name + ': ' + (res && res.error ? res.error : 'failed'));
        return;
      }
      var before = bucket.records.length;
      var merged = PA.mergeRecords(bucket.records, res.records);
      var cross = before + res.records.length - merged.records.length;
      bucket.records = merged.records;
      res.quality.duplicateRows += Math.max(0, cross);
      bucket.quality = PA.mergeQuality(bucket.quality, res.quality);
      bucket.files.push({
        id: uid(),
        name: f.name,
        uploadedAt: Date.now(),
        text: res.rawText,
        rowCount: res.records.length,
        format: res.format,
        quality: res.quality
      });
      anyOk = true;
      messages.push(f.name + ': ' + res.records.length + ' row(s)' + (cross ? ', ' + cross + ' dupes skipped' : ''));
    });
    state.pendingImport = null;
    // Jump UI to the target day/shift
    state.showLegacy = false;
    state.rosterShift = p.targetShift;
    var ws = startOfWeek(new Date(p.targetDate + 'T00:00:00'));
    state.weekStart = ws;
    state.activeWeekKey = ymd(ws);
    for (var i = 0; i < 5; i++) {
      if (ymd(addDays(ws, i)) === p.targetDate) { state.dayIdx = i; break; }
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
      els.lastUpdated.textContent = state.showLegacy ? 'Legacy' : (DAY_NAMES[state.dayIdx] + ' · ' + shiftLabel(state.rosterShift));
      return;
    }
    els.lastUpdated.textContent = (state.showLegacy ? 'Legacy' : DAY_NAMES[state.dayIdx]) +
      ' · ' + recs.length + ' rows';
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
        } else if (data && data.version === 2 && Array.isArray(data.records)) {
          var m = migrateV2ToV3(data);
          state.byDate = m.byDate;
          state.legacy = m.legacy;
          await saveData();
          toast('Migrated previous Packer data — open Legacy to review older rows');
        } else if (data && typeof data === 'object') {
          // Very old shift-keyed object
          var legacyRecs = PA.migrateLegacyShifts(data);
          state.legacy = { records: legacyRecs, files: [], quality: PA.summarizeQuality(legacyRecs, null) };
          state.byDate = {};
          await saveData();
          toast('Migrated legacy shift tabs into Legacy view');
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
      targetDate: activeDateKey(),
      targetShift: state.rosterShift === 'afternoon' ? 'afternoon' : 'morning',
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
      if (state.showLegacy) {
        toast('Switch out of Legacy to clear a calendar day', 'err');
        return;
      }
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
  if (els.exportWeekBtn) {
    els.exportWeekBtn.addEventListener('click', function () { exportActiveWeek(true); });
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
  if (els.legacyBtn) {
    els.legacyBtn.addEventListener('click', function () {
      state.showLegacy = !state.showLegacy;
      state.page = 1;
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
      renderKpis();
      renderTable();
      renderCharts();
      renderQuality();
    });
  }
  if (els.views) {
    els.views.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
      if (!btn) return;
      state.view = btn.getAttribute('data-view') || 'strike';
      state.page = 1;
      applyView();
    });
  }

  window.__packerDashboard = { refresh: renderAll, exportWeek: exportActiveWeek };
  loadAll();
})();
