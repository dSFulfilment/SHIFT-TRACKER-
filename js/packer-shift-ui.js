/**
 * Packer tab UI — Boxes + Intra Hour pickers + Morning / Afternoon scores + why.
 */
(function () {
  'use strict';

  var root = document.getElementById('psrRoot');
  if (!root) return;

  var PSR = window.PackerShiftReport;
  var statusEl = document.getElementById('psrStatus');
  var viewsEl = document.getElementById('psrViews');
  var panelEl = document.getElementById('psrPanel');
  var runBtn = document.getElementById('psrRunBtn');
  var clearBtn = document.getElementById('psrClearBtn');
  var boxesIn = document.getElementById('psrBoxes');
  var intraIn = document.getElementById('psrIntra');
  var toastEl = document.getElementById('packerToast');

  var report = null;
  var view = 'morning';
  var openPacker = null;

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function scriptsOk() {
    return !!(PSR && typeof PSR.buildReportFromFiles === 'function' && typeof XLSX !== 'undefined');
  }

  function fileLabel(inp) {
    return inp && inp.files && inp.files[0] ? inp.files[0].name : '';
  }

  function refreshReadyState() {
    var hasBoxes = !!(boxesIn && boxesIn.files && boxesIn.files[0]);
    var hasIntra = !!(intraIn && intraIn.files && intraIn.files[0]);
    var ok = scriptsOk();

    runBtn.disabled = !ok;

    if (!ok) {
      statusEl.className = 'psr-status err';
      statusEl.textContent =
        'Report scripts did not load. If you still see this, refresh — Packer code is inlined in this HTML file.';
      return;
    }

    if (!report) {
      var parts = [];
      parts.push(hasBoxes ? ('Boxes: ' + fileLabel(boxesIn)) : 'Boxes: not selected');
      parts.push(hasIntra ? ('Intra: ' + fileLabel(intraIn)) : 'Intra: not selected');
      statusEl.className = 'psr-status';
      statusEl.textContent = parts.join(' · ') +
        (hasBoxes && hasIntra
          ? ' → click Build report'
          : ' → select Boxes + Intra Hour, then Build report');
    }
  }

  function flagClass(flag) {
    if (flag === 'Below target') return 'flag-below';
    if (flag === 'Dipped below strike') return 'flag-dip';
    if (flag === 'On/above target') return 'flag-ok';
    return 'flag-none';
  }

  function verdictClass(v) {
    if (v === 'under strike') return 'flag-below';
    if (v === 'under target') return 'flag-dip';
    if (v === 'on/above target') return 'flag-ok';
    return 'flag-none';
  }

  function renderTotals(t) {
    if (!t) return '';
    var pct = t.pctOfTarget != null ? t.pctOfTarget.toFixed(1) + '%' : '—';
    var gap = t.boxGap != null
      ? ((t.boxGap >= 0 ? '+' : '') + Math.round(t.boxGap).toLocaleString() + ' boxes vs target')
      : '—';
    return '<div class="psr-totals">' +
      '<div><b>Shift amount</b><span>' + escapeHtml(t.shiftLabel) + '</span></div>' +
      '<div><b>Packers</b><span>' + t.packers + '</span></div>' +
      '<div><b>Hours</b><span>' + t.hours.toFixed(1) + '</span></div>' +
      '<div><b>Boxes packed</b><span>' + Math.round(t.boxes).toLocaleString() + '</span></div>' +
      '<div><b>Target boxes</b><span>' + Math.round(t.targetBoxes).toLocaleString() + '</span></div>' +
      '<div><b>% of target</b><span>' + pct + '</span></div>' +
      '<div><b>Gap</b><span>' + gap + '</span></div>' +
      '<div><b>Flags</b><span>Below ' + t.below + ' · Dip ' + t.dipped + ' · OK ' + t.onTarget + '</span></div>' +
      '</div>';
  }

  function renderHourDetail(r) {
    var hours = r.hourLines || [];
    if (!hours.length) {
      return '<h3 class="psr-detail-h">Boxes each hour</h3>' +
        '<p class="psr-prose">No Intra Hour rows for this packer on this shift (hours before 14:00 = Morning, 14:00+ = Afternoon).</p>';
    }
    var total = hours.reduce(function (s, h) { return s + h.boxes; }, 0);
    var html = '<h3 class="psr-detail-h">Boxes each hour</h3>' +
      '<table class="psr-table"><thead><tr><th>Hour</th><th>Boxes</th></tr></thead><tbody>';
    hours.forEach(function (h) {
      html += '<tr><td>' + escapeHtml(h.hourLabel) + '</td><td>' + Math.round(h.boxes).toLocaleString() + '</td></tr>';
    });
    html += '<tr><td><b>Total</b></td><td><b>' + Math.round(total).toLocaleString() + '</b></td></tr>';
    html += '</tbody></table>';
    return html;
  }

  function renderSkuDetail(r) {
    var html = '<h3 class="psr-detail-h">SKUs on this shift</h3>';
    if (r.why) html += '<p class="psr-why">' + escapeHtml(r.why || '') + '</p>';
    if (!r.skuLines || !r.skuLines.length) {
      return html + '<p class="psr-prose">No SKU lines.</p>';
    }
    html += '<table class="psr-table"><thead><tr>' +
      '<th>SKU</th><th>Hours</th><th>Boxes</th><th>Actual BPH</th><th>Target</th><th>Strike</th><th>Line %</th><th>Verdict</th>' +
      '</tr></thead><tbody>';
    r.skuLines.forEach(function (L) {
      html += '<tr class="' + verdictClass(L.verdict) + '">' +
        '<td>' + escapeHtml(L.sku) + '</td>' +
        '<td>' + (L.hours != null ? L.hours.toFixed(2) : '—') + '</td>' +
        '<td>' + Math.round(L.boxes).toLocaleString() + '</td>' +
        '<td>' + (L.actualBph != null ? L.actualBph.toFixed(1) : '—') + '</td>' +
        '<td>' + (L.targetBph != null ? L.targetBph : '—') + '</td>' +
        '<td>' + (L.strikeBph != null ? L.strikeBph : '—') + '</td>' +
        '<td>' + (L.linePct != null ? L.linePct.toFixed(0) + '%' : '—') + '</td>' +
        '<td>' + escapeHtml(L.verdict) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    html += '<p class="psr-prose psr-note">Intra Hour has boxes per hour but no SKU — SKUs above are from Boxes Packed for the whole shift, not split by hour.</p>';
    return html;
  }

  function renderPackerDetail(r) {
    return '<div class="psr-packer-detail">' + renderHourDetail(r) + renderSkuDetail(r) + '</div>';
  }

  function renderShiftTable(rows, totals) {
    if (!rows.length) {
      return '<p class="psr-prose">No packers for this shift in the Boxes export.</p>';
    }
    var html = renderTotals(totals);
    html += '<p class="psr-prose">Click a packer for boxes each hour and which SKUs they were on.</p>';
    html += '<table class="psr-table"><thead><tr>' +
      '<th>Packer</th><th>Hours</th><th>Boxes</th><th>Target</th><th>%</th><th>Gap</th><th>Flag</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r, idx) {
      var open = openPacker === r.workerDisplay;
      html += '<tr class="' + flagClass(r.flag) + ' psr-row" data-packer="' + escapeHtml(r.workerDisplay) + '" data-idx="' + idx + '" style="cursor:pointer">' +
        '<td><b>' + escapeHtml(r.workerDisplay) + '</b>' + (open ? ' ▾' : ' ▸') + '</td>' +
        '<td>' + (r.hours != null ? r.hours.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.boxes != null ? Math.round(r.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (r.targetBoxes != null ? r.targetBoxes.toFixed(1) : '—') + '</td>' +
        '<td>' + (r.pctOfTarget != null ? r.pctOfTarget.toFixed(1) + '%' : '—') + '</td>' +
        '<td>' + (r.boxGap != null ? ((r.boxGap >= 0 ? '+' : '') + Math.round(r.boxGap)) : '—') + '</td>' +
        '<td>' + escapeHtml(r.flag) + '</td>' +
        '</tr>';
      if (open) {
        html += '<tr class="psr-detail"><td colspan="7">' + renderPackerDetail(r) + '</td></tr>';
      }
    });
    html += '</tbody></table>';
    return html;
  }

  function renderByHour() {
    var rows = report.byHour || [];
    if (!rows.length) {
      return '<p class="psr-prose">No Intra Hour rows loaded.</p>';
    }
    var html = '<p class="psr-prose">Boxes packed each clock hour. Expand a packer to see which SKUs they worked on that shift (SKU is not in the Intra export).</p>';
    rows.forEach(function (H) {
      html += '<div class="psr-hour-block">' +
        '<div class="psr-hour-head"><b>' + escapeHtml(H.hourLabel) + '</b> · ' +
        escapeHtml(H.shiftLabel) + ' · ' + Math.round(H.boxes).toLocaleString() + ' boxes · ' +
        H.packers.length + ' packer' + (H.packers.length === 1 ? '' : 's') + '</div>';
      html += '<table class="psr-table"><thead><tr><th>Packer</th><th>Boxes this hour</th><th>SKUs on shift</th></tr></thead><tbody>';
      H.packers.forEach(function (p) {
        var skuTxt = (p.skus && p.skus.length)
          ? p.skus.map(function (s) {
            return 'SKU ' + s.sku + ' (' + Math.round(s.boxes || 0) + ' boxes)';
          }).join(', ')
          : '—';
        html += '<tr>' +
          '<td><b>' + escapeHtml(p.workerDisplay) + '</b></td>' +
          '<td>' + Math.round(p.boxes).toLocaleString() + '</td>' +
          '<td>' + escapeHtml(skuTxt) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    });
    return html;
  }

  function renderExclusions() {
    var e = report.exclusions;
    var rows = [
      ['Blank worker name or Primary Sku', e.blank_worker_or_sku],
      ['Missing Boxes Packed', e.missing_boxes],
      ['Missing Packing Time Seconds', e.missing_time],
      ['Unknown SKU lines (kept & flagged, not dropped)', e.unknown_sku_lines]
    ];
    var html = '<table class="psr-table"><thead><tr><th>Reason</th><th>Count</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + escapeHtml(r[0]) + '</td><td>' + r[1] + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderTargets() {
    var html = '<table class="psr-table"><thead><tr><th>SKU</th><th>Target BPH</th><th>Strike line BPH</th></tr></thead><tbody>';
    Object.keys(PSR.SKU_TARGETS).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sku) {
      var t = PSR.SKU_TARGETS[sku];
      html += '<tr><td>' + sku + '</td><td>' + t.target + '</td><td>' + t.strike + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderHow() {
    return '<div class="psr-prose">' +
      '<h2>Files</h2>' +
      '<p>Pick <b>Boxes Packed by Worker</b> and <b>Intra Hour Floor Performance</b>, then <b>Build report</b>.</p>' +
      '<h2>Hour + SKU</h2>' +
      '<p>Click a packer (or open <b>By hour</b>) to see boxes each hour from Intra, and which SKUs they were on from Boxes. The Intra export does not include SKU, so hour and SKU cannot be joined into one cell.</p>' +
      '</div>';
  }

  function render() {
    if (!report) return;
    viewsEl.hidden = false;
    var tabs = viewsEl.querySelectorAll('[data-psr-view]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-psr-view') === view);
    }
    if (view === 'morning') panelEl.innerHTML = renderShiftTable(report.morning, report.morningTotals);
    else if (view === 'afternoon') panelEl.innerHTML = renderShiftTable(report.afternoon, report.afternoonTotals);
    else if (view === 'byhour') panelEl.innerHTML = renderByHour();
    else if (view === 'exclusions') panelEl.innerHTML = renderExclusions();
    else if (view === 'targets') panelEl.innerHTML = renderTargets();
    else panelEl.innerHTML = renderHow();
  }

  async function run() {
    openPacker = null;
    if (!scriptsOk()) {
      refreshReadyState();
      toast('Scripts not loaded');
      return;
    }
    if (!(boxesIn.files && boxesIn.files[0])) {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Select file 1: Boxes_Packed_by_Worker.xlsx';
      toast('Need Boxes file');
      return;
    }
    if (!(intraIn.files && intraIn.files[0])) {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Select file 2: Intra_Hour_Floor_Performance.xlsx';
      toast('Need Intra Hour file');
      return;
    }

    statusEl.className = 'psr-status';
    statusEl.textContent = 'Reading exports…';
    runBtn.disabled = true;
    try {
      report = await PSR.buildReportFromFiles(boxesIn.files[0], intraIn.files[0]);
      var bits = [
        'Morning: ' + report.morning.length + ' packers',
        'Afternoon: ' + report.afternoon.length + ' packers',
        'Raw lines: ' + report.rawLines.length
      ];
      if (report.morningTotals && report.morningTotals.pctOfTarget != null) {
        bits.push('Morning shift ' + report.morningTotals.pctOfTarget.toFixed(0) + '% of target');
      }
      if (report.warnings && report.warnings.length) bits.push(report.warnings.join(' '));
      statusEl.className = 'psr-status';
      statusEl.textContent = bits.join(' · ');
      view = 'morning';
      render();
      toast('Report ready');
    } catch (e) {
      report = null;
      viewsEl.hidden = true;
      panelEl.innerHTML = '';
      statusEl.className = 'psr-status err';
      statusEl.textContent = (e && e.message) ? e.message : String(e);
      toast('Could not build report');
      console.error(e);
    } finally {
      runBtn.disabled = !scriptsOk();
    }
  }

  function clearAll() {
    if (boxesIn) boxesIn.value = '';
    if (intraIn) intraIn.value = '';
    report = null;
    openPacker = null;
    viewsEl.hidden = true;
    panelEl.innerHTML = '';
    refreshReadyState();
  }

  [boxesIn, intraIn].forEach(function (inp) {
    if (!inp) return;
    inp.addEventListener('change', function () {
      report = null;
      viewsEl.hidden = true;
      panelEl.innerHTML = '';
      refreshReadyState();
    });
  });
  runBtn.addEventListener('click', function () { run(); });
  clearBtn.addEventListener('click', clearAll);
  viewsEl.addEventListener('click', function (e) {
    var tab = e.target && e.target.closest ? e.target.closest('[data-psr-view]') : null;
    if (tab) {
      view = tab.getAttribute('data-psr-view');
      openPacker = null;
      render();
    }
  });
  panelEl.addEventListener('click', function (e) {
    var row = e.target && e.target.closest ? e.target.closest('tr.psr-row') : null;
    if (!row) return;
    var name = row.getAttribute('data-packer');
    openPacker = openPacker === name ? null : name;
    render();
  });

  window.__packerDashboard = {
    refresh: function () {},
    getReport: function () { return report; }
  };
  refreshReadyState();
})();
