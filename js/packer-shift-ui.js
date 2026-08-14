/**
 * Packer tab UI — upload 3× xlsx shift exports and show Morning / Afternoon scores + why.
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
  var uploadBtn = document.getElementById('psrUploadBtn');
  var multiIn = document.getElementById('psrMulti');
  var dropEl = document.getElementById('psrDrop');
  var fileStatusEl = document.getElementById('psrFileStatus');
  var toastEl = document.getElementById('packerToast');

  var report = null;
  var view = 'morning';
  var openPacker = null;
  var boxesFile = null;
  var intraFile = null;
  var summaryFile = null;

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

  function classifyFile(file) {
    var n = String(file && file.name || '').toLowerCase().replace(/\s+/g, '_');
    if (n.indexOf('boxes_packed') !== -1 || n.indexOf('boxespacked') !== -1) return 'boxes';
    if (n.indexOf('intra_hour') !== -1 || n.indexOf('intrahour') !== -1 || n.indexOf('intra-hour') !== -1) return 'intra';
    if (n.indexOf('overall_summary') !== -1 || n.indexOf('overallsummary') !== -1 || n.indexOf('summary_by_packer') !== -1) return 'summary';
    return null;
  }

  function setFileStatus() {
    if (!fileStatusEl) return;
    var map = {
      boxes: boxesFile ? boxesFile.name : 'not loaded',
      intra: intraFile ? intraFile.name : 'optional',
      summary: summaryFile ? summaryFile.name : 'not loaded'
    };
    var nodes = fileStatusEl.querySelectorAll('[data-kind]');
    for (var i = 0; i < nodes.length; i++) {
      var kind = nodes[i].getAttribute('data-kind');
      var span = nodes[i].querySelector('span');
      if (span) span.textContent = map[kind] || '—';
      nodes[i].classList.toggle('is-set', !!(kind === 'boxes' ? boxesFile : kind === 'intra' ? intraFile : summaryFile));
    }
  }

  function refreshReadyState() {
    var ok = scriptsOk();
    runBtn.disabled = !ok;
    if (uploadBtn) uploadBtn.disabled = !ok;
    setFileStatus();

    if (!ok) {
      statusEl.className = 'psr-status err';
      statusEl.textContent =
        'Report scripts did not load. If you still see this, refresh — Packer code is inlined in this HTML file.';
      return;
    }

    if (!report) {
      statusEl.className = 'psr-status';
      if (boxesFile && summaryFile) {
        statusEl.textContent = 'Files ready → building report…';
      } else {
        statusEl.textContent = 'Click Upload (or drop files) — need Boxes + Summary. Intra optional.';
      }
    }
  }

  function ingestFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var unknown = [];
    files.forEach(function (f) {
      var kind = classifyFile(f);
      if (kind === 'boxes') boxesFile = f;
      else if (kind === 'intra') intraFile = f;
      else if (kind === 'summary') summaryFile = f;
      else unknown.push(f.name);
    });
    report = null;
    viewsEl.hidden = true;
    panelEl.innerHTML = '';
    refreshReadyState();

    if (unknown.length) {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Unrecognised file name(s): ' + unknown.join(', ') +
        '. Expected names containing Boxes_Packed, Intra_Hour, or Overall_Summary.';
      toast('Check file names');
      return;
    }
    if (boxesFile && summaryFile) {
      toast('Files loaded');
      run();
    } else {
      var missing = [];
      if (!boxesFile) missing.push('Boxes Packed by Worker');
      if (!summaryFile) missing.push('Overall Summary');
      statusEl.className = 'psr-status';
      statusEl.textContent = 'Still need: ' + missing.join(' + ');
      toast('Need more files');
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

  function renderSkuDetail(r) {
    if (!r.skuLines || !r.skuLines.length) return '<p class="psr-prose">No SKU lines.</p>';
    var html = '<p class="psr-why">' + escapeHtml(r.why || '') + '</p>';
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
    return html;
  }

  function renderShiftTable(rows, totals) {
    if (!rows.length) {
      return '<p class="psr-prose">No included packers for this shift (after facility filter and 15-minute rule).</p>';
    }
    var html = renderTotals(totals);
    html += '<p class="psr-prose">Click a packer to see which SKUs made the shift work — or didn’t.</p>';
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
        html += '<tr class="psr-detail"><td colspan="7">' + renderSkuDetail(r) + '</td></tr>';
      }
    });
    html += '</tbody></table>';
    return html;
  }

  function renderExclusions() {
    var e = report.exclusions;
    var rows = [
      ['Blank worker name or Primary Sku', e.blank_worker_or_sku],
      ['Missing Boxes Packed', e.missing_boxes],
      ['Missing Packing Time Seconds', e.missing_time],
      ['Under 15-minute filter (changeover/setup noise)', e.under_15_min],
      ['Not in Dandenong South facility summary', e.not_dandenong_south],
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
      '<h2>Upload</h2>' +
      '<p>Click <b>Upload</b> and select all three xlsx exports at once (or drop them on the dashed box). Files are matched by name.</p>' +
      '<h2>Shift amount / why</h2>' +
      '<p>Morning and Afternoon show total boxes vs target. Click a packer to see which SKUs dragged or held the score.</p>' +
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
    if (!boxesFile) {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Upload Boxes_Packed_by_Worker.xlsx';
      toast('Need Boxes file');
      return;
    }
    if (!summaryFile) {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Upload Overall_Summary_by_Packer_and_Date.xlsx';
      toast('Need Summary file');
      return;
    }

    statusEl.className = 'psr-status';
    statusEl.textContent = 'Reading exports…';
    runBtn.disabled = true;
    if (uploadBtn) uploadBtn.disabled = true;
    try {
      report = await PSR.buildReportFromFiles(boxesFile, summaryFile, intraFile || null);
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
      if (uploadBtn) uploadBtn.disabled = !scriptsOk();
    }
  }

  function clearAll() {
    boxesFile = null;
    intraFile = null;
    summaryFile = null;
    if (multiIn) multiIn.value = '';
    report = null;
    openPacker = null;
    viewsEl.hidden = true;
    panelEl.innerHTML = '';
    refreshReadyState();
  }

  if (uploadBtn && multiIn) {
    uploadBtn.addEventListener('click', function () { multiIn.click(); });
    multiIn.addEventListener('change', function () {
      ingestFiles(multiIn.files);
    });
  }
  if (dropEl) {
    ;['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropEl.classList.add('drag');
      });
    });
    ;['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropEl.classList.remove('drag');
      });
    });
    dropEl.addEventListener('drop', function (e) {
      ingestFiles(e.dataTransfer && e.dataTransfer.files);
    });
  }
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
