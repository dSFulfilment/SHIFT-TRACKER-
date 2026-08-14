/**
 * Packer tab UI — upload 3× xlsx shift exports and show Morning / Afternoon scores.
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
  var summaryIn = document.getElementById('psrSummary');
  var toastEl = document.getElementById('packerToast');

  var report = null;
  var view = 'morning';

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function syncRunEnabled() {
    runBtn.disabled = !(boxesIn.files && boxesIn.files[0] && summaryIn.files && summaryIn.files[0]);
  }

  function flagClass(flag) {
    if (flag === 'Below target') return 'flag-below';
    if (flag === 'Dipped below strike') return 'flag-dip';
    if (flag === 'On/above target') return 'flag-ok';
    return 'flag-none';
  }

  function renderShiftTable(rows) {
    if (!rows.length) {
      return '<p class="psr-prose">No included packers for this shift (after facility filter and 15-minute rule).</p>';
    }
    var html = '<table class="psr-table"><thead><tr>' +
      '<th>Packer</th><th>Hours</th><th>Boxes</th><th>Target boxes</th><th>% of target</th><th>Flag</th><th>Notes</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr class="' + flagClass(r.flag) + '">' +
        '<td>' + escapeHtml(r.workerDisplay) + '</td>' +
        '<td>' + (r.hours != null ? r.hours.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.boxes != null ? Math.round(r.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (r.targetBoxes != null ? r.targetBoxes.toFixed(1) : '—') + '</td>' +
        '<td>' + (r.pctOfTarget != null ? r.pctOfTarget.toFixed(1) + '%' : '—') + '</td>' +
        '<td>' + escapeHtml(r.flag) + '</td>' +
        '<td>' + escapeHtml(r.notes || '') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    html += '<p class="psr-prose" style="margin-top:10px">Sorted worst → best by % of target. Red = below target, amber = dipped below strike, green = on/above target.</p>';
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
      '<h2>What this shows</h2>' +
      '<p>Per packer, per shift: are they hitting SKU targets for Dandenong South? Morning and Afternoon are never merged.</p>' +
      '<h2>Inputs</h2>' +
      '<ul>' +
      '<li><b>Boxes Packed by Worker</b> — performance source (packer + SKU + shift).</li>' +
      '<li><b>Overall Summary</b> — facility filter only (Dandenong South). Blended BPH is ignored because targets differ by SKU.</li>' +
      '<li><b>Intra Hour</b> — kept for a later hour-slowdown view; not used in % of target.</li>' +
      '</ul>' +
      '<h2>Math</h2>' +
      '<ul>' +
      '<li>Hours on SKU = Packing Time Seconds ÷ 3600</li>' +
      '<li>Actual BPH = Boxes ÷ Hours</li>' +
      '<li>Lines under 15 minutes are excluded (SKU changeover noise).</li>' +
      '<li>% of target = total boxes on included known-SKU lines ÷ total (hours × SKU target) × 100</li>' +
      '<li>Below target: % &lt; 100. Dipped below strike: % ≥ 100 but any included line under that SKU’s strike. Otherwise on/above.</li>' +
      '</ul>' +
      '<h2>Auditable Excel</h2>' +
      '<p>For a workbook with live SUMIFS / INDEX-MATCH formulas (Raw data + Morning + Afternoon sheets), run:</p>' +
      '<p><code>python -m packer_shift_report --dir /path/to/exports --out report.xlsx</code></p>' +
      '</div>';
  }

  function render() {
    if (!report) return;
    viewsEl.hidden = false;
    var tabs = viewsEl.querySelectorAll('[data-psr-view]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-psr-view') === view);
    }
    if (view === 'morning') panelEl.innerHTML = renderShiftTable(report.morning);
    else if (view === 'afternoon') panelEl.innerHTML = renderShiftTable(report.afternoon);
    else if (view === 'exclusions') panelEl.innerHTML = renderExclusions();
    else if (view === 'targets') panelEl.innerHTML = renderTargets();
    else panelEl.innerHTML = renderHow();
  }

  async function run() {
    statusEl.className = 'psr-status';
    statusEl.textContent = 'Reading exports…';
    if (!PSR || typeof PSR.buildReportFromFiles !== 'function') {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Packer shift report module failed to load (js/packer-shift-report.js).';
      return;
    }
    if (typeof XLSX === 'undefined') {
      statusEl.className = 'psr-status err';
      statusEl.textContent = 'Spreadsheet reader failed to load (js/xlsx.mini.min.js). Open the app from the project folder so those scripts can load.';
      return;
    }
    try {
      report = await PSR.buildReportFromFiles(boxesIn.files[0], summaryIn.files[0], intraIn.files[0] || null);
      var bits = [
        'Morning: ' + report.morning.length + ' packers',
        'Afternoon: ' + report.afternoon.length + ' packers',
        'Raw lines: ' + report.rawLines.length
      ];
      if (report.warnings && report.warnings.length) bits.push(report.warnings.join(' '));
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
    }
  }

  function clearAll() {
    boxesIn.value = '';
    intraIn.value = '';
    summaryIn.value = '';
    report = null;
    viewsEl.hidden = true;
    panelEl.innerHTML = '';
    statusEl.className = 'psr-status';
    statusEl.textContent = 'Upload the three shift exports, then Build report.';
    syncRunEnabled();
  }

  [boxesIn, intraIn, summaryIn].forEach(function (inp) {
    inp.addEventListener('change', syncRunEnabled);
  });
  runBtn.addEventListener('click', function () { run(); });
  clearBtn.addEventListener('click', clearAll);
  viewsEl.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-psr-view]') : null;
    if (!btn) return;
    view = btn.getAttribute('data-psr-view');
    render();
  });

  window.__packerDashboard = {
    refresh: function () {},
    getReport: function () { return report; }
  };
  syncRunEnabled();
})();
