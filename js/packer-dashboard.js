/**
 * Packer CSV performance dashboard UI.
 * Depends on window.PackerAnalytics and #tabPacker markup.
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

  var state = {
    version: 2,
    files: [], // { id, name, uploadedAt, text } — raw CSV kept unchanged
    records: [],
    quality: PA.emptyQuality(),
    lastUpdated: null,
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
    defaultShift: 'morning_shift'
  };

  var els = {
    lastUpdated: document.getElementById('pkLastUpdated'),
    fileInput: document.getElementById('pkFileInput'),
    uploadBtn: document.getElementById('pkUploadBtn'),
    clearBtn: document.getElementById('pkClearBtn'),
    tagSelect: document.getElementById('pkTagSelect'),
    filters: document.getElementById('pkFilters'),
    kpis: document.getElementById('pkKpis'),
    charts: document.getElementById('pkCharts'),
    tableWrap: document.getElementById('pkTableWrap'),
    quality: document.getElementById('pkQuality'),
    detail: document.getElementById('pkDetail'),
    status: document.getElementById('pkStatus'),
    toast: document.getElementById('packerToast'),
    body: document.getElementById('pkPanels')
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg, type) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.style.background = type === 'err' ? '#c01c14' : '#0d1117';
    els.toast.style.color = '#fff';
    els.toast.classList.add('show');
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(function () {
      els.toast.classList.remove('show');
    }, 3200);
  }

  function uid() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function filtered() {
    return PA.filterRecords(state.records, state.filters);
  }

  function statusPill(status) {
    if (!status) return '<span class="pk-status pk-status-unknown">No target</span>';
    var cls =
      status.key === 'excellent'
        ? 'pk-status-excellent'
        : status.key === 'on_target'
          ? 'pk-status-on'
          : status.key === 'needs_attention'
            ? 'pk-status-attention'
            : 'pk-status-unknown';
    return '<span class="pk-status ' + cls + '" title="' + escapeHtml(status.label) + '">' + escapeHtml(status.label) + '</span>';
  }

  function barChart(items, valueKey, labelKey, opts) {
    opts = opts || {};
    var max = 0;
    items.forEach(function (it) {
      var v = it[valueKey];
      if (v != null && v > max) max = v;
    });
    if (!items.length) {
      return '<div class="pk-empty-inline">No data for this chart</div>';
    }
    if (max <= 0) max = 1;
    var rows = items
      .slice(0, opts.limit || 12)
      .map(function (it) {
        var v = it[valueKey];
        var label = it[labelKey];
        var pct = v == null ? 0 : Math.round((v / max) * 100);
        var display = opts.format ? opts.format(v) : PA.formatRate(v);
        return (
          '<div class="pk-bar-row">' +
          '<div class="pk-bar-lbl" title="' +
          escapeHtml(String(label)) +
          '">' +
          escapeHtml(String(label)) +
          '</div>' +
          '<div class="pk-bar-track" role="img" aria-label="' +
          escapeHtml(String(label) + ': ' + display) +
          '"><div class="pk-bar-fill' +
          (opts.tone ? ' ' + opts.tone : '') +
          '" style="width:' +
          pct +
          '%"></div></div>' +
          '<div class="pk-bar-val">' +
          escapeHtml(display) +
          '</div></div>'
        );
      })
      .join('');
    return '<div class="pk-bars">' + rows + '</div>';
  }

  function columnChart(items, valueKey, labelFn) {
    if (!items.length) return '<div class="pk-empty-inline">No data for this chart</div>';
    var max = 1;
    items.forEach(function (it) {
      if (it[valueKey] != null && it[valueKey] > max) max = it[valueKey];
    });
    var bars = items
      .map(function (it) {
        var v = it[valueKey] || 0;
        var h = Math.max(4, Math.round((v / max) * 100));
        var lbl = labelFn(it);
        return (
          '<div class="pk-col">' +
          '<div class="pk-col-bar" style="height:' +
          h +
          '%" title="' +
          escapeHtml(lbl + ': ' + PA.formatNumber(v)) +
          '"></div>' +
          '<div class="pk-col-lbl">' +
          escapeHtml(lbl) +
          '</div></div>'
        );
      })
      .join('');
    return '<div class="pk-cols">' + bars + '</div>';
  }

  function renderStatus() {
    if (!els.status) return;
    if (state.loading) {
      els.status.innerHTML = '<div class="pk-banner pk-banner-load">Loading CSV data…</div>';
      return;
    }
    if (state.error) {
      els.status.innerHTML =
        '<div class="pk-banner pk-banner-err" role="alert">' + escapeHtml(state.error) + '</div>';
      return;
    }
    if (!state.records.length) {
      els.status.innerHTML =
        '<div class="pk-banner pk-banner-empty">' +
        '<strong>No packer data yet</strong><br>' +
        'Upload one or more CSV exports (summary, hourly, end-of-shift, or detailed). ' +
        'Raw files are kept unchanged; totals rows and malformed workers are skipped.</div>';
      return;
    }
    els.status.innerHTML = '';
  }

  function renderFilters() {
    if (!els.filters) return;
    var opts = PA.uniqueOptions(state.records);
    var f = state.filters;
    function options(list, selected, getVal, getLbl, allLabel) {
      return (
        '<option value="">' +
        allLabel +
        '</option>' +
        list
          .map(function (item) {
            var v = getVal(item);
            var l = getLbl(item);
            return (
              '<option value="' +
              escapeHtml(String(v)) +
              '"' +
              (String(selected) === String(v) ? ' selected' : '') +
              '>' +
              escapeHtml(String(l)) +
              '</option>'
            );
          })
          .join('')
      );
    }
    els.filters.innerHTML =
      '<div class="pk-filter-grid">' +
      '<label class="pk-fl"><span>Report date</span><select data-f="reportDate">' +
      options(
        opts.dates,
        f.reportDate,
        function (d) {
          return d;
        },
        function (d) {
          return PA.formatDateAU(d);
        },
        'All dates'
      ) +
      '</select></label>' +
      '<label class="pk-fl"><span>Shift</span><select data-f="shift">' +
      options(
        opts.shifts,
        f.shift,
        function (s) {
          return s.key;
        },
        function (s) {
          return s.label;
        },
        'All shifts'
      ) +
      '</select></label>' +
      '<label class="pk-fl"><span>Worker</span><select data-f="worker">' +
      options(
        opts.workers,
        f.worker,
        function (w) {
          return w.key;
        },
        function (w) {
          return w.label;
        },
        'All workers'
      ) +
      '</select></label>' +
      '<label class="pk-fl"><span>Station</span><select data-f="station">' +
      options(
        opts.stations,
        f.station,
        function (s) {
          return s;
        },
        function (s) {
          return s;
        },
        'All stations'
      ) +
      '</select></label>' +
      '<label class="pk-fl"><span>SKU size</span><select data-f="sku">' +
      options(
        opts.skus,
        f.sku,
        function (s) {
          return s;
        },
        function (s) {
          return s;
        },
        'All SKUs'
      ) +
      '</select></label>' +
      '<label class="pk-fl"><span>Hour</span><select data-f="hour">' +
      options(
        opts.hours,
        f.hour,
        function (h) {
          return h;
        },
        function (h) {
          return PA.formatHourLabel(h);
        },
        'All hours'
      ) +
      '</select></label>' +
      '<label class="pk-fl"><span>Min boxes/hour</span><input type="number" min="0" step="0.1" data-f="minPerformance" value="' +
      escapeHtml(f.minPerformance) +
      '" placeholder="e.g. 15"></label>' +
      '<label class="pk-fl pk-fl-grow"><span>Search table</span><input type="search" data-f="search" value="' +
      escapeHtml(f.search) +
      '" placeholder="Worker, station, SKU…"></label>' +
      '</div>';

    Array.prototype.forEach.call(els.filters.querySelectorAll('[data-f]'), function (input) {
      var ev = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(ev, function () {
        state.filters[input.getAttribute('data-f')] = input.value;
        state.page = 1;
        renderKpis();
        renderCharts();
        renderTable();
        renderQuality();
      });
    });
  }

  function renderKpis() {
    if (!els.kpis) return;
    var rows = filtered();
    if (!state.records.length) {
      els.kpis.innerHTML = '';
      return;
    }
    var k = PA.aggregateKpis(rows);
    var cards = [
      { label: 'Total boxes packed', value: PA.formatNumber(k.totalBoxes), tone: 'cb', sub: 'Sum of filtered rows' },
      { label: 'Total items packed', value: PA.formatNumber(k.totalItems), tone: 'cb', sub: 'Sum of filtered rows' },
      {
        label: 'Avg boxes / hour',
        value: PA.formatRate(k.averageBoxesPerHour),
        tone: 'cg',
        sub: 'Calculated · boxes ÷ packing hours'
      },
      {
        label: 'Avg efficiency',
        value: PA.formatPercent(k.averageEfficiency),
        tone: 'cg',
        sub: 'Calculated · weighted vs target'
      },
      {
        label: 'Total packing hours',
        value: PA.formatHours(k.totalPackingHours),
        tone: 'ca',
        sub: 'Sum of packing time'
      },
      {
        label: 'Avg idle %',
        value: PA.formatPercent(k.averageIdlePercentage),
        tone: 'ca',
        sub: 'Calculated · weighted idle ÷ shift hours'
      },
      {
        label: 'Active workers',
        value: PA.formatNumber(k.activeWorkers),
        tone: '',
        sub: 'Distinct packers in filter'
      }
    ];
    els.kpis.innerHTML =
      '<div class="pk-kpi-grid">' +
      cards
        .map(function (c) {
          return (
            '<div class="pk-kpi ' +
            c.tone +
            '"><div class="pk-kpi-l">' +
            escapeHtml(c.label) +
            '</div><div class="pk-kpi-v">' +
            escapeHtml(c.value) +
            '</div><div class="pk-kpi-s">' +
            escapeHtml(c.sub) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>';
  }

  function renderCharts() {
    if (!els.charts) return;
    if (!state.records.length) {
      els.charts.innerHTML = '';
      return;
    }
    var rows = filtered();
    var workers = PA.aggregateWorkers(rows);
    var byHour = PA.aggregateByHour(rows);
    var stations = PA.aggregateStations(rows);
    var skus = PA.aggregateSkus(rows);
    var shifts = PA.aggregateShifts(rows);

    var ranking = workers.map(function (w) {
      return { label: w.workerName, boxesPerHour: w.boxesPerHour };
    });
    var eff = workers.map(function (w) {
      return { label: w.workerName, efficiency: w.efficiency };
    });
    var idle = workers
      .filter(function (w) {
        return w.idlePercentage != null;
      })
      .map(function (w) {
        return { label: w.workerName, idle: w.idlePercentage };
      });

    els.charts.innerHTML =
      '<div class="pk-chart-grid">' +
      chartCard('Worker ranking by boxes / hour', barChart(ranking, 'boxesPerHour', 'label', { format: PA.formatRate, tone: 'tone-b' })) +
      chartCard(
        'Boxes packed by hour',
        columnChart(byHour, 'boxes', function (it) {
          return PA.formatHourLabel(it.hour);
        })
      ) +
      chartCard(
        'Efficiency vs target by worker',
        barChart(eff, 'efficiency', 'label', {
          format: PA.formatPercent,
          tone: 'tone-g'
        })
      ) +
      chartCard(
        'Idle % by worker',
        idle.length
          ? barChart(idle, 'idle', 'label', { format: PA.formatPercent, tone: 'tone-a' })
          : '<div class="pk-empty-inline">Idle time not present in uploaded CSVs</div>'
      ) +
      chartCard(
        'Station performance',
        barChart(stations, 'boxesPerHour', 'label', { format: PA.formatRate, tone: 'tone-b' })
      ) +
      chartCard(
        'SKU-size performance',
        barChart(skus, 'boxesPerHour', 'label', { format: PA.formatRate, tone: 'tone-g' })
      ) +
      chartCard(
        'Shift comparison',
        barChart(shifts, 'boxesPerHour', 'label', { format: PA.formatRate, tone: 'tone-a' })
      ) +
      '</div>';
  }

  function chartCard(title, body) {
    return (
      '<section class="pk-chart-card"><h3 class="pk-chart-title">' +
      escapeHtml(title) +
      '</h3>' +
      body +
      '</section>'
    );
  }

  function renderTable() {
    if (!els.tableWrap) return;
    if (!state.records.length) {
      els.tableWrap.innerHTML = '';
      return;
    }
    var workers = PA.aggregateWorkers(filtered());
    // Re-sort if user chose a column other than default rankScore
    if (state.sortKey !== 'rankScore') {
      workers = PA.sortRows(workers, state.sortKey, state.sortDir);
      workers.forEach(function (w, i) {
        w.rank = i + 1;
      });
    } else if (state.sortDir === 'asc') {
      workers = workers.slice().reverse();
      workers.forEach(function (w, i) {
        w.rank = i + 1;
      });
    }
    var page = PA.paginate(workers, state.page, PAGE_SIZE);

    function th(key, label, cls) {
      var arrow = state.sortKey === key ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return (
        '<th class="' +
        (cls || '') +
        '"><button type="button" class="pk-th" data-sort="' +
        key +
        '">' +
        escapeHtml(label + arrow) +
        '</button></th>'
      );
    }

    var body = page.rows
      .map(function (w) {
        return (
          '<tr class="pk-worker-row" data-worker="' +
          escapeHtml(w.workerKey) +
          '" tabindex="0">' +
          '<td class="r mn">' +
          w.rank +
          '</td>' +
          '<td><button type="button" class="pk-link" data-worker="' +
          escapeHtml(w.workerKey) +
          '">' +
          escapeHtml(w.workerName) +
          '</button></td>' +
          '<td>' +
          escapeHtml(w.shift) +
          '</td>' +
          '<td>' +
          escapeHtml(w.station) +
          '</td>' +
          '<td class="r mn">' +
          escapeHtml(PA.formatNumber(w.boxes)) +
          '</td>' +
          '<td class="r mn">' +
          escapeHtml(PA.formatNumber(w.items)) +
          '</td>' +
          '<td class="r mn">' +
          escapeHtml(PA.formatHours(w.packingHours)) +
          '</td>' +
          '<td class="r mn" title="Calculated">' +
          escapeHtml(PA.formatRate(w.boxesPerHour)) +
          '</td>' +
          '<td class="r mn" title="Calculated">' +
          escapeHtml(PA.formatRate(w.itemsPerHour)) +
          '</td>' +
          '<td class="r mn" title="Calculated">' +
          escapeHtml(PA.formatSeconds(w.secondsPerBox)) +
          '</td>' +
          '<td class="r mn" title="Calculated">' +
          escapeHtml(PA.formatPercent(w.efficiency)) +
          '</td>' +
          '<td class="r mn" title="Calculated">' +
          escapeHtml(PA.formatPercent(w.idlePercentage)) +
          '</td>' +
          '<td>' +
          statusPill(w.status) +
          '</td></tr>'
        );
      })
      .join('');

    els.tableWrap.innerHTML =
      '<section class="pk-table-card">' +
      '<div class="pk-table-hdr"><h2 class="pk-section-title">Worker performance</h2>' +
      '<div class="pk-table-meta">' +
      page.total +
      ' worker' +
      (page.total === 1 ? '' : 's') +
      ' · ranked by weighted boxes/hour · calculated fields show N/A when denominator is missing</div></div>' +
      '<div class="tw pk-tw"><table><thead><tr>' +
      th('rank', 'Rank', 'r') +
      th('workerName', 'Worker') +
      th('shift', 'Shift') +
      th('station', 'Station') +
      th('boxes', 'Boxes', 'r') +
      th('items', 'Items', 'r') +
      th('packingHours', 'Packing hours', 'r') +
      th('boxesPerHour', 'Boxes/hour', 'r') +
      th('itemsPerHour', 'Items/hour', 'r') +
      th('secondsPerBox', 'Sec/box', 'r') +
      th('efficiency', 'Eff. vs target', 'r') +
      th('idlePercentage', 'Idle %', 'r') +
      th('status', 'Performance status') +
      '</tr></thead><tbody>' +
      (body ||
        '<tr><td colspan="13" class="empty-td">No workers match the current filters</td></tr>') +
      '</tbody></table></div>' +
      '<div class="pk-pager">' +
      '<button type="button" class="btn btn-sm" data-page="prev"' +
      (page.page <= 1 ? ' disabled' : '') +
      '>Previous</button>' +
      '<span>Page ' +
      page.page +
      ' of ' +
      page.pages +
      '</span>' +
      '<button type="button" class="btn btn-sm" data-page="next"' +
      (page.page >= page.pages ? ' disabled' : '') +
      '>Next</button></div></section>';

    Array.prototype.forEach.call(els.tableWrap.querySelectorAll('[data-sort]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else {
          state.sortKey = key;
          state.sortDir = key === 'workerName' || key === 'shift' || key === 'station' || key === 'status' ? 'asc' : 'desc';
        }
        state.page = 1;
        renderTable();
      });
    });
    Array.prototype.forEach.call(els.tableWrap.querySelectorAll('[data-page]'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        state.page += btn.getAttribute('data-page') === 'next' ? 1 : -1;
        renderTable();
      });
    });
    Array.prototype.forEach.call(els.tableWrap.querySelectorAll('[data-worker]'), function (el) {
      function open() {
        state.selectedWorker = el.getAttribute('data-worker');
        renderDetail();
      }
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function renderDetail() {
    if (!els.detail) return;
    if (!state.selectedWorker) {
      els.detail.innerHTML = '';
      els.detail.hidden = true;
      return;
    }
    var detail = PA.workerDetail(filtered(), state.selectedWorker);
    if (!detail.summary) {
      els.detail.innerHTML = '';
      els.detail.hidden = true;
      return;
    }
    var s = detail.summary;
    els.detail.hidden = false;
    var trend =
      detail.daily.length > 1
        ? columnChart(detail.daily, 'boxes', function (it) {
            return it.date === 'unknown' ? '?' : PA.formatDateAU(it.date);
          })
        : '<div class="pk-empty-inline">Trend needs multiple report dates</div>';

    els.detail.innerHTML =
      '<div class="pk-detail-panel" role="dialog" aria-label="Worker detail">' +
      '<div class="pk-detail-hdr">' +
      '<div><h2 class="pk-section-title">' +
      escapeHtml(s.workerName) +
      '</h2>' +
      '<div class="pk-table-meta">' +
      escapeHtml(s.shift) +
      ' · ' +
      statusPill(s.status) +
      '</div></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pkDetailClose">Close</button></div>' +
      '<div class="pk-detail-kpis">' +
      detailMetric('Boxes', PA.formatNumber(s.boxes)) +
      detailMetric('Packing hours', PA.formatHours(s.packingHours)) +
      detailMetric('Boxes / hour', PA.formatRate(s.boxesPerHour)) +
      detailMetric('Idle %', PA.formatPercent(s.idlePercentage)) +
      detailMetric('Efficiency', PA.formatPercent(s.efficiency)) +
      '</div>' +
      '<div class="pk-detail-grid">' +
      '<section><h3 class="pk-chart-title">Daily trend</h3>' +
      trend +
      '</section>' +
      '<section><h3 class="pk-chart-title">Hourly boxes</h3>' +
      columnChart(detail.hourly, 'boxes', function (it) {
        return PA.formatHourLabel(it.hour);
      }) +
      '</section>' +
      '<section><h3 class="pk-chart-title">Station history</h3>' +
      barChart(detail.stations, 'boxes', 'label', { format: PA.formatNumber, tone: 'tone-b' }) +
      '</section>' +
      '<section><h3 class="pk-chart-title">SKU performance</h3>' +
      barChart(detail.skus, 'boxesPerHour', 'label', { format: PA.formatRate, tone: 'tone-g' }) +
      '</section>' +
      '</div></div>';

    var close = document.getElementById('pkDetailClose');
    if (close)
      close.addEventListener('click', function () {
        state.selectedWorker = null;
        renderDetail();
      });
  }

  function detailMetric(label, value) {
    return (
      '<div class="pk-detail-metric"><div class="pk-kpi-l">' +
      escapeHtml(label) +
      '</div><div class="pk-kpi-v" style="font-size:1.15rem">' +
      escapeHtml(value) +
      '</div></div>'
    );
  }

  function renderQuality() {
    if (!els.quality) return;
    if (!state.records.length && !state.files.length) {
      els.quality.innerHTML = '';
      return;
    }
    var q = PA.summarizeQuality(state.records, state.quality);
    // Recount duplicates already removed is in quality.duplicateRows from imports
    var items = [
      ['Valid rows', q.validRows],
      ['Invalid rows', q.invalidRows],
      ['Missing worker names', q.missingWorkerNames],
      ['Missing dates', q.missingDates],
      ['Missing packing time', q.missingPackingTime],
      ['Duplicate rows skipped', q.duplicateRows],
      ['Unknown / inconsistent shifts', q.unknownShifts],
      ['Failed calculated fields', q.failedCalculations],
      ['Totals rows skipped', q.totalsRowsSkipped],
      ['Mixed SKU rows (SKU cleared)', q.mixedSkuRows || 0],
      ['Files kept (raw unchanged)', state.files.length]
    ];
    els.quality.innerHTML =
      '<section class="pk-quality">' +
      '<h2 class="pk-section-title">Data quality</h2>' +
      '<div class="pk-quality-grid">' +
      items
        .map(function (it) {
          return (
            '<div class="pk-quality-item"><div class="pk-kpi-v" style="font-size:1.1rem">' +
            escapeHtml(PA.formatNumber(it[1])) +
            '</div><div class="pk-kpi-l">' +
            escapeHtml(it[0]) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="pk-file-list">' +
      state.files
        .map(function (f) {
          return (
            '<div class="pk-file-chip" title="Raw CSV preserved">' +
            escapeHtml(f.name) +
            ' · ' +
            escapeHtml(new Date(f.uploadedAt).toLocaleString('en-AU')) +
            '</div>'
          );
        })
        .join('') +
      '</div></section>';
  }

  function renderAll() {
    renderStatus();
    renderFilters();
    renderKpis();
    renderCharts();
    renderTable();
    renderDetail();
    renderQuality();
    updateHeader();
  }

  function updateHeader() {
    if (!els.lastUpdated) return;
    if (!state.lastUpdated) {
      els.lastUpdated.textContent = 'No uploads yet';
      return;
    }
    var opts = PA.uniqueOptions(state.records);
    var parts = [];
    if (opts.dates[0]) parts.push('Latest date ' + PA.formatDateAU(opts.dates[0]));
    parts.push(state.records.length + ' rows');
    parts.push(state.files.length + ' file' + (state.files.length === 1 ? '' : 's'));
    els.lastUpdated.textContent = parts.join(' · ');
  }

  async function saveData() {
    try {
      var payload = {
        version: 2,
        files: state.files,
        records: state.records,
        quality: state.quality,
        lastUpdated: state.lastUpdated,
        defaultShift: state.defaultShift
      };
      await window.storage.set(STORAGE_KEY, JSON.stringify(payload), false);
      return true;
    } catch (e) {
      console.error('packer save failed', e);
      return false;
    }
  }

  async function loadAll() {
    state.loading = true;
    renderStatus();
    try {
      var r = await window.storage.get(STORAGE_KEY, false);
      if (r && r.value) {
        var data = JSON.parse(r.value);
        if (data && data.version === 2 && Array.isArray(data.records)) {
          state.files = data.files || [];
          state.records = data.records || [];
          state.quality = data.quality || PA.emptyQuality();
          state.lastUpdated = data.lastUpdated || null;
          state.defaultShift = data.defaultShift || 'morning_shift';
        } else {
          // Legacy shift-keyed object → migrate into flat records; no raw files available
          state.records = PA.migrateLegacyShifts(data);
          state.files = [];
          state.quality = PA.summarizeQuality(state.records, null);
          state.lastUpdated = Date.now();
          await saveData();
        }
      }
    } catch (e) {
      console.error('packer load failed', e);
      state.error = 'Could not read saved data — showing an empty dashboard so nothing is overwritten.';
      toast(state.error, 'err');
    }
    state.loading = false;
    if (els.tagSelect) {
      // Keep a default shift tag for hourly / EOS uploads that lack a Shift column
      var shifts = [
        { key: 'morning_shift', label: 'Morning' },
        { key: 'afternoon_shift', label: 'Afternoon' },
        { key: 'evening_shift', label: 'Evening' },
        { key: 'night_shift', label: 'Night' }
      ];
      els.tagSelect.innerHTML = shifts
        .map(function (s) {
          return (
            '<option value="' +
            s.key +
            '"' +
            (s.key === state.defaultShift ? ' selected' : '') +
            '>' +
            s.label +
            '</option>'
          );
        })
        .join('');
    }
    renderAll();
  }

  async function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    state.loading = true;
    state.error = null;
    renderStatus();
    var messages = [];
    var anyOk = false;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var text = await file.text();
        var res = PA.processCsvText(text, {
          sourceFile: file.name,
          defaultShift: (els.tagSelect && els.tagSelect.value) || state.defaultShift
        });
        if (!res.ok) {
          messages.push(file.name + ': ' + res.error);
          continue;
        }
        // Keep original raw text unchanged
        state.files.push({
          id: uid(),
          name: file.name,
          uploadedAt: Date.now(),
          text: res.rawText
        });
        var before = state.records.length;
        var merged = PA.mergeRecords(state.records, res.records);
        var newDupes = merged.duplicatesRemoved - 0;
        // duplicatesRemoved counts all dupes in concat; subtract those already in existing
        var onlyIncomingDupes = PA.mergeRecords([], res.records);
        var crossDupes = before + onlyIncomingDupes.records.length - merged.records.length;
        state.records = merged.records;
        res.quality.duplicateRows += Math.max(0, crossDupes);
        state.quality = PA.mergeQuality(state.quality, res.quality);
        state.lastUpdated = Date.now();
        anyOk = true;
        messages.push(
          file.name +
            ': ' +
            res.records.length +
            ' row(s) (' +
            res.format +
            ')' +
            (crossDupes > 0 ? ', ' + crossDupes + ' duplicate(s) skipped' : '')
        );
      } catch (err) {
        messages.push('Failed to read ' + file.name);
        console.error(err);
      }
    }
    state.loading = false;
    var saved = true;
    if (anyOk) {
      saved = await saveData();
      if (!saved) messages.push('Could not save to storage — data may be lost on refresh');
    }
    if (!anyOk && messages.length) state.error = messages.join(' · ');
    renderAll();
    toast(messages.join(' · ') || 'No files imported', anyOk && saved ? undefined : 'err');
  }

  async function clearAll() {
    if (!confirm('Clear all imported packer CSV data? Raw copies in storage will be removed from this browser.'))
      return;
    state.files = [];
    state.records = [];
    state.quality = PA.emptyQuality();
    state.lastUpdated = null;
    state.selectedWorker = null;
    state.error = null;
    state.page = 1;
    await saveData();
    renderAll();
    toast('Packer data cleared');
  }

  // Events
  if (els.uploadBtn && els.fileInput) {
    els.uploadBtn.addEventListener('click', function () {
      els.fileInput.click();
    });
    els.fileInput.addEventListener('change', function (e) {
      importFiles(e.target.files).then(function () {
        els.fileInput.value = '';
      });
    });
  }
  if (els.clearBtn) els.clearBtn.addEventListener('click', clearAll);
  if (els.tagSelect) {
    els.tagSelect.addEventListener('change', function () {
      state.defaultShift = els.tagSelect.value;
      saveData();
    });
  }

  loadAll();
})();
