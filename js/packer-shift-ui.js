/**
 * Packer tab UI — Boxes + Intra + Raw Data; packer detail combines by SKU.
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
  var exportBtn = document.getElementById('psrExportBtn');
  var clearBtn = document.getElementById('psrClearBtn');
  var boxesIn = document.getElementById('psrBoxes');
  var intraIn = document.getElementById('psrIntra');
  var rawIn = document.getElementById('psrRaw');
  var execIn = document.getElementById('psrExec');
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
    var hasRaw = !!(rawIn && rawIn.files && rawIn.files[0]);
    var hasExec = !!(execIn && execIn.files && execIn.files[0]);
    var ok = scriptsOk();

    runBtn.disabled = !ok;
    if (exportBtn) exportBtn.disabled = !(ok && report);

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
      parts.push(hasRaw ? ('Raw Data: ' + fileLabel(rawIn)) : 'Raw Data: not selected');
      parts.push(hasExec ? ('Exec Summary: ' + fileLabel(execIn)) : 'Exec Summary: not selected');
      statusEl.className = 'psr-status';
      statusEl.textContent = parts.join(' · ') +
        (hasBoxes && hasIntra
          ? ' → click Build report'
          : ' → select Boxes + Intra Hour, then Build report');
    }
  }

  function flagClass(flag) {
    if (flag === 'Below strike') return 'flag-below'; // red
    if (flag === 'Below target') return 'flag-dip';   // orange — cleared strike, under target
    if (flag === 'On/above target') return 'flag-ok'; // green
    return 'flag-none';
  }

  /** Green / orange / red labels for strike check. */
  function strikeLabel(flag) {
    if (flag === 'On/above target') return 'Above target';
    if (flag === 'Below target') return 'Above strike';
    if (flag === 'Below strike') return 'Below strike';
    return flag || '—';
  }

  function strikeBadge(flag) {
    return '<span class="psr-strike-badge ' + flagClass(flag) + '">' +
      escapeHtml(strikeLabel(flag)) + '</span>';
  }

  function verdictClass(v) {
    if (v === 'under strike') return 'flag-below'; // red
    if (v === 'under target') return 'flag-dip';   // orange
    if (v === 'on/above target') return 'flag-ok';
    return 'flag-none';
  }

  function renderStrikeBanner(r, sum) {
    var flag = (sum && sum.flag) || r.flag;
    var bph = sum && sum.avgBph != null ? sum.avgBph.toFixed(1) : '—';
    var target = sum && sum.avgTarget != null ? sum.avgTarget.toFixed(1) : '—';
    var strike = sum && sum.avgStrike != null ? sum.avgStrike.toFixed(1) : '—';
    var pct = sum && sum.pctOfTarget != null
      ? sum.pctOfTarget.toFixed(0) + '%'
      : (r.pctOfTarget != null ? r.pctOfTarget.toFixed(0) + '%' : '—');
    return '<div class="psr-strike-banner ' + flagClass(flag) + '">' +
      strikeBadge(flag) +
      '<span>BPH <b>' + escapeHtml(bph) + '</b> · Target <b>' + escapeHtml(target) +
      '</b> · Strike <b>' + escapeHtml(strike) + '</b> · ' + escapeHtml(pct) + ' of target</span>' +
      '</div>';
  }

  function renderTotals(t) {
    if (!t) return '';
    var pct = t.pctOfTarget != null ? t.pctOfTarget.toFixed(1) + '%' : '—';
    var gap = t.boxGap != null
      ? ((t.boxGap >= 0 ? '+' : '') + Math.round(t.boxGap).toLocaleString() + ' boxes vs target')
      : '—';
    var intraH = t.intraHours != null ? t.intraHours : 0;
    var intraB = t.intraBoxes != null ? t.intraBoxes : 0;
    return '<div class="psr-totals">' +
      '<div><b>Shift amount</b><span>' + escapeHtml(t.shiftLabel) + '</span></div>' +
      '<div><b>Packers</b><span>' + t.packers + '</span></div>' +
      '<div><b>Pack h</b><span>' + t.hours.toFixed(1) + '</span></div>' +
      '<div><b>Intra h</b><span>' + Number(intraH).toFixed(1) + '</span></div>' +
      '<div><b>Boxes (file)</b><span>' + Math.round(t.boxes).toLocaleString() + '</span></div>' +
      '<div><b>Intra boxes</b><span>' + Math.round(intraB).toLocaleString() + '</span></div>' +
      '<div><b>Target boxes</b><span>' + Math.round(t.targetBoxes).toLocaleString() + '</span></div>' +
      '<div><b>% of target</b><span>' + pct + '</span></div>' +
      '<div><b>Gap</b><span>' + gap + '</span></div>' +
      '<div><b>Flags</b><span>Strike ' + t.below + ' · Target ' + t.dipped + ' · OK ' + t.onTarget + '</span></div>' +
      '</div>';
  }

  function idlePctDisplay(idle) {
    if (idle == null || !isFinite(idle)) return null;
    return idle <= 1.5 ? idle * 100 : idle;
  }

  /**
   * One table by SKU: Boxes Packed (score) + matching single-size Raw Data (context).
   * Multi-size Raw Data rows are listed under the table — never split onto a SKU.
   */
  function renderCombinedBySku(r) {
    var skuLines = (r.skuLines || []).filter(function (L) {
      return !(L.verdict && String(L.verdict).indexOf('excluded') === 0);
    });
    var segs = r.rawDataSegments || [];
    var singleBySku = {};
    var multiSegs = [];
    segs.forEach(function (s) {
      if (s.isMixed) {
        multiSegs.push(s);
        return;
      }
      var sku = (s.skus && s.skus.length === 1) ? s.skus[0] : null;
      if (sku == null) return;
      if (!singleBySku[sku]) singleBySku[sku] = [];
      singleBySku[sku].push(s);
    });

    var stationsBySku = {};
    (r.rawLines || []).forEach(function (L) {
      if (L.sku == null) return;
      if (!stationsBySku[L.sku]) stationsBySku[L.sku] = {};
      if (L.station != null && String(L.station).trim() !== '') {
        stationsBySku[L.sku][String(L.station).trim()] = true;
      }
    });

    var html = '<h3 class="psr-detail-h">By SKU</h3>';
    if (r.why) html += '<p class="psr-why">' + escapeHtml(r.why || '') + '</p>';
    html += '<p class="psr-prose">Boxes Packed = score. Raw Data (single size) = idle / session BPH for that SKU. '
      + 'Strike colours: <b>green</b> above target · <b>orange</b> above strike · <b>red</b> below strike.</p>';

    if (!skuLines.length) {
      html += '<p class="psr-prose">No Boxes SKU lines for this packer/shift.</p>';
    } else {
      var sumHead = PSR.summarizePackerTotalAvg(r);
      html += renderStrikeBanner(r, sumHead);

      html += '<table class="psr-table"><thead><tr>' +
        '<th>SKU</th><th>Station</th><th>Hours</th><th>Boxes</th><th>BPH</th>' +
        '<th>Target</th><th>Strike</th><th>%</th><th>Verdict</th>' +
        '<th>Raw idle</th><th>Raw BPH</th>' +
        '</tr></thead><tbody>';

      skuLines.forEach(function (L) {
        var stMap = stationsBySku[L.sku] || {};
        var stations = Object.keys(stMap).sort().join(', ') || '—';

        var rawMatches = singleBySku[L.sku] || [];
        var idleTxt = '—';
        var rawBphTxt = '—';
        if (rawMatches.length) {
          var idles = [];
          var bphs = [];
          rawMatches.forEach(function (s) {
            var id = idlePctDisplay(s.idlePct);
            if (id != null) idles.push(id);
            if (s.actualBph != null) bphs.push(s.actualBph);
          });
          if (idles.length) {
            idleTxt = (idles.reduce(function (a, b) { return a + b; }, 0) / idles.length).toFixed(0) + '%';
            if (rawMatches.length > 1) idleTxt += ' ×' + rawMatches.length;
          }
          if (bphs.length) {
            rawBphTxt = (bphs.reduce(function (a, b) { return a + b; }, 0) / bphs.length).toFixed(1);
          }
        }

        html += '<tr class="' + verdictClass(L.verdict) + '">' +
          '<td><b>' + escapeHtml(L.sku) + '</b></td>' +
          '<td>' + escapeHtml(stations) + '</td>' +
          '<td>' + (L.hours != null ? L.hours.toFixed(2) : '—') + '</td>' +
          '<td>' + Math.round(L.boxes).toLocaleString() + '</td>' +
          '<td>' + (L.actualBph != null ? L.actualBph.toFixed(1) : '—') + '</td>' +
          '<td>' + (L.targetBph != null ? L.targetBph : '—') + '</td>' +
          '<td>' + (L.strikeBph != null ? L.strikeBph : '—') + '</td>' +
          '<td>' + (L.linePct != null ? L.linePct.toFixed(0) + '%' : '—') + '</td>' +
          '<td>' + escapeHtml(L.verdict) + '</td>' +
          '<td>' + escapeHtml(idleTxt) + '</td>' +
          '<td>' + escapeHtml(rawBphTxt) + '</td>' +
          '</tr>';
      });

      var sum = sumHead;
      var hoursCell = sum.useShiftHours
        ? (sum.packHours.toFixed(2) + ' pack · ' + sum.shiftHours.toFixed(2) + ' shift')
        : sum.packHours.toFixed(2);
      var breakNote = (sum.useShiftHours && sum.breakMinutes > 0)
        ? (' (−' + Math.round(sum.breakMinutes) + 'm breaks)')
        : '';

      html += '<tr class="psr-total-row ' + flagClass(sum.flag) + '">' +
        '<td colspan="2"><b>Total / avg</b></td>' +
        '<td><b>' + escapeHtml(hoursCell + breakNote) + '</b></td>' +
        '<td><b>' + Math.round(sum.boxes).toLocaleString() + '</b></td>' +
        '<td><b>' + (sum.avgBph != null ? sum.avgBph.toFixed(1) : '—') + '</b></td>' +
        '<td><b>' + (sum.avgTarget != null ? sum.avgTarget.toFixed(1) : '—') + '</b></td>' +
        '<td><b>' + (sum.avgStrike != null ? sum.avgStrike.toFixed(1) : '—') + '</b></td>' +
        '<td><b>' + (sum.pctOfTarget != null ? sum.pctOfTarget.toFixed(0) + '%' : '—') + '</b></td>' +
        '<td><b>' + strikeBadge(sum.flag) + '</b></td>' +
        '<td colspan="2"></td>' +
        '</tr>';
      html += '</tbody></table>';
      if (sum.useShiftHours) {
        html += '<p class="psr-prose psr-note">Total BPH / % / strike colour use <b>Shift h</b> (Intra'
          + (sum.breakMinutes > 0 ? ' minus tea/meal' : '')
          + '), not Pack h. SKU rows still show packing time.</p>';
      }
    }

    if (multiSegs.length) {
      html += '<p class="psr-prose psr-note"><b>Multi-size Raw Data</b> (not scored onto one SKU): ';
      html += multiSegs.map(function (s) {
        return escapeHtml(s.boxSkuSizes || '') +
          (s.boxes != null ? ' · ' + Math.round(s.boxes) + ' boxes' : '');
      }).join('; ');
      html += '.</p>';
    } else if (!segs.length) {
      html += '<p class="psr-prose psr-note">No Raw Data for this packer — Raw idle / Raw BPH stay blank.</p>';
    }

    return html;
  }

  function renderHourDetail(r) {
    var hours = r.hourLines || [];
    if (!hours.length) {
      return '<h3 class="psr-detail-h">Boxes each hour</h3>' +
        '<p class="psr-prose">No Intra Hour rows for this packer on this shift (hours before 14:00 = Morning, 14:00+ = Afternoon).</p>';
    }
    var totalBoxes = hours.reduce(function (s, h) { return s + h.boxes; }, 0);
    var intraHours = r.intraHours != null ? r.intraHours : hours.length;
    var html = '<h3 class="psr-detail-h">Boxes each hour</h3>' +
      '<p class="psr-prose"><b>Intra h total: ' + Number(intraHours).toFixed(0) + '</b> clock hour'
      + (intraHours === 1 ? '' : 's')
      + (r.breakMinutes > 0
        ? (' · breaks −' + Math.round(r.breakMinutes) + 'm → Shift h ' +
          (r.shiftHours != null ? r.shiftHours.toFixed(2) : '—'))
        : '')
      + '. Packer target / flags use Shift h when Intra is loaded.</p>' +
      '<table class="psr-table"><thead><tr><th>Hour</th><th>Boxes</th></tr></thead><tbody>';
    hours.forEach(function (h) {
      html += '<tr><td>' + escapeHtml(h.hourLabel) + '</td><td>' + Math.round(h.boxes).toLocaleString() + '</td></tr>';
    });
    html += '<tr class="psr-total-row"><td><b>Total · ' + Number(intraHours).toFixed(0) + ' Intra h</b></td><td><b>' +
      Math.round(totalBoxes).toLocaleString() + '</b></td></tr>';
    html += '</tbody></table>';
    return html;
  }

  function renderPackerDetail(r) {
    return '<div class="psr-packer-detail">' +
      renderCombinedBySku(r) +
      renderHourDetail(r) +
      '</div>';
  }

  /** Prefer Raw Data size list when present; else Boxes Primary Sku sizes. */
  function sizesCell(r) {
    var segs = r.rawDataSegments || [];
    if (segs.length) {
      var set = {};
      segs.forEach(function (s) {
        (s.skus || []).forEach(function (sku) { set[sku] = true; });
      });
      var skus = Object.keys(set).map(Number).filter(function (n) { return isFinite(n); })
        .sort(function (a, b) { return a - b; });
      if (skus.length) {
        return escapeHtml(skus.map(function (s) { return s + 'g'; }).join(' · '));
      }
    }
    var mix = r.skuMix;
    if (!mix || !mix.label) return '—';
    return escapeHtml(mix.label);
  }

  function renderShiftTable(rows, totals) {
    if (!rows.length) {
      return '<p class="psr-prose">No packers for this shift in the Boxes export.</p>';
    }
    var html = renderTotals(totals);
    html += '<p class="psr-prose">Boxes Packed by Worker + Intra Hour side by side. Click a packer for <b>By SKU</b> and hour breakdown. '
      + '<b>Pack h / Boxes (file)</b> from Boxes. <b>Intra h / Intra boxes</b> from Intra. '
      + '<b>Shift h</b> = Intra − breaks (when Breaks matched).</p>';
    html += '<table class="psr-table"><thead><tr>' +
      '<th>Packer</th><th>Sizes</th><th>Pack h</th><th>Intra h</th><th>Shift h</th>' +
      '<th>Boxes (file)</th><th>Intra boxes</th><th>Target</th><th>%</th><th>Gap</th><th>Flag</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r, idx) {
      var open = openPacker === r.workerDisplay;
      var intraH = r.intraHours != null ? r.intraHours : ((r.hourLines && r.hourLines.length) || null);
      html += '<tr class="' + flagClass(r.flag) + ' psr-row" data-packer="' + escapeHtml(r.workerDisplay) + '" data-idx="' + idx + '" style="cursor:pointer">' +
        '<td><b>' + escapeHtml(r.workerDisplay) + '</b>' + (open ? ' ▾' : ' ▸') + '</td>' +
        '<td>' + sizesCell(r) + '</td>' +
        '<td>' + (r.hours != null ? r.hours.toFixed(2) : '—') + '</td>' +
        '<td>' + (intraH != null ? Number(intraH).toFixed(0) : '—') + '</td>' +
        '<td>' + (r.shiftHours != null ? r.shiftHours.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.boxes != null ? Math.round(r.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (r.intraBoxes != null ? Math.round(r.intraBoxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (r.targetBoxes != null ? r.targetBoxes.toFixed(1) : '—') + '</td>' +
        '<td>' + (r.pctOfTarget != null ? r.pctOfTarget.toFixed(1) + '%' : '—') + '</td>' +
        '<td>' + (r.boxGap != null ? ((r.boxGap >= 0 ? '+' : '') + Math.round(r.boxGap)) : '—') + '</td>' +
        '<td>' + strikeBadge(r.flag) + '</td>' +
        '</tr>';
      if (open) {
        html += '<tr class="psr-detail"><td colspan="11">' + renderPackerDetail(r) + '</td></tr>';
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
    var clockSlots = rows.length;
    var packerHours = 0;
    var totalBoxes = 0;
    rows.forEach(function (H) {
      packerHours += (H.packers || []).length;
      totalBoxes += H.boxes || 0;
    });
    var html = '<p class="psr-prose"><b>Intra + Boxes</b> · <b>Intra h total: ' + packerHours + '</b> packer-hours across <b>' +
      clockSlots + '</b> clock hour' + (clockSlots === 1 ? '' : 's') +
      ' · ' + Math.round(totalBoxes).toLocaleString() + ' Intra boxes. '
      + 'Each row shows Intra boxes that hour next to Boxes Packed by Worker score for the shift.</p>';
    rows.forEach(function (H) {
      html += '<div class="psr-hour-block">' +
        '<div class="psr-hour-head"><b>' + escapeHtml(H.hourLabel) + '</b> · ' +
        escapeHtml(H.shiftLabel) + ' · ' + Math.round(H.boxes).toLocaleString() + ' Intra boxes · ' +
        H.packers.length + ' packer' + (H.packers.length === 1 ? '' : 's') + '</div>';
      html += '<table class="psr-table"><thead><tr>' +
        '<th>Packer</th><th>Intra boxes</th><th>Boxes (file)</th><th>Pack h</th><th>Intra h</th>' +
        '<th>%</th><th>Flag</th><th>Sizes</th>' +
        '</tr></thead><tbody>';
      H.packers.forEach(function (p) {
        var bs = p.boxesScore || {};
        var info = p.skuInfo || {};
        var mix = info.mix;
        var mixTxt = mix && mix.label ? mix.label : '—';
        html += '<tr class="' + flagClass(bs.flag) + '">' +
          '<td><b>' + escapeHtml(p.workerDisplay) + '</b></td>' +
          '<td>' + Math.round(p.boxes).toLocaleString() + '</td>' +
          '<td>' + (bs.boxesFile != null ? Math.round(bs.boxesFile).toLocaleString() : '—') + '</td>' +
          '<td>' + (bs.packHours != null ? Number(bs.packHours).toFixed(2) : '—') + '</td>' +
          '<td>' + (bs.intraHours != null ? Number(bs.intraHours).toFixed(0) : '—') + '</td>' +
          '<td>' + (bs.pctOfTarget != null ? Number(bs.pctOfTarget).toFixed(0) + '%' : '—') + '</td>' +
          '<td>' + escapeHtml(bs.flag || '—') + '</td>' +
          '<td>' + escapeHtml(mixTxt) + '</td>' +
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
      '<p>Pick <b>Boxes</b>, <b>Intra Hour</b>, optional <b>Raw Data</b> (Dandenong South) and <b>Executive Summary</b> (Dandenong South hours), then <b>Build report</b>.</p>' +
      '<h2>Hours</h2>' +
      '<p><b>Pack h</b> = Boxes packing time. <b>Shift h</b> = Intra clock hours for that shift, minus tea (~15m) and meal (~30m) from the Breaks tab when that packer is on a group; else Raw Data / Executive Summary.</p>' +
      '<h2>What each file is for</h2>' +
      '<p><b>Boxes Packed by Worker</b> = SKUs, Pack h, Boxes (file), target/flag. <b>Intra Hour</b> = Intra h + Intra boxes (and hour rows). Morning/Afternoon and <b>Intra + Boxes</b> show both together.</p>' +
      '<h2>One packer view</h2>' +
      '<p>Open a packer for one <b>By SKU</b> table: Boxes score + Raw Data idle/BPH on the same SKU row, plus Intra boxes each hour.</p>' +
      '<h2>Export</h2>' +
      '<p>After Build report, click <b>Export report</b> for Excel (shifts, SKU detail, Raw Data, By hour, etc.).</p>' +
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

  function readJsonLocal(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /** Tea/meal minutes from Breaks for the linked ops day (names matched to export workers). */
  function loadBreakMinutesForReport() {
    if (!PSR || typeof PSR.breakMinutesLookupFromStorage !== 'function') return {};
    var linked = window.__opsDayLink && typeof window.__opsDayLink.get === 'function'
      ? window.__opsDayLink.get()
      : null;
    var dateKey = linked && linked.dateKey ? linked.dateKey : null;
    var bp = readJsonLocal('breakPlanner');
    var planner = readJsonLocal('planner');
    if (!bp) return {};
    return PSR.breakMinutesLookupFromStorage(bp, planner, dateKey) || {};
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
      var rawFile = (rawIn && rawIn.files && rawIn.files[0]) ? rawIn.files[0] : null;
      var execFile = (execIn && execIn.files && execIn.files[0]) ? execIn.files[0] : null;
      var breakMins = loadBreakMinutesForReport();
      var breakN = Object.keys(breakMins).length;
      report = await PSR.buildReportFromFiles(
        boxesIn.files[0],
        intraIn.files[0],
        rawFile,
        execFile,
        breakMins
      );
      var bits = [
        'Morning: ' + report.morning.length + ' packers',
        'Afternoon: ' + report.afternoon.length + ' packers',
        'Boxes lines: ' + report.rawLines.length
      ];
      if (breakN) bits.push('Breaks applied: ' + breakN);
      if (report.rawDataRows && report.rawDataRows.length) {
        bits.push('Raw Data: ' + report.rawDataRows.length + ' rows');
      }
      if (report.morningTotals && report.morningTotals.pctOfTarget != null) {
        bits.push('Morning shift ' + report.morningTotals.pctOfTarget.toFixed(0) + '% of target');
      }
      if (report.warnings && report.warnings.length) bits.push(report.warnings.join(' '));
      statusEl.className = 'psr-status';
      statusEl.textContent = bits.join(' · ');
      view = 'morning';
      render();
      refreshReadyState();
      toast(breakN ? 'Report ready (breaks applied)' : 'Report ready');
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
      if (exportBtn) exportBtn.disabled = !(scriptsOk() && report);
    }
  }

  function downloadExport() {
    if (!report) {
      toast('Build report first');
      return;
    }
    if (!scriptsOk() || typeof PSR.buildExportWorkbook !== 'function') {
      toast('Export not available');
      return;
    }
    try {
      var wb = PSR.buildExportWorkbook(report);
      var buf = PSR.workbookToArrayBuffer(wb);
      var blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'packer_shift_report_' + stamp + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Report downloaded');
    } catch (e) {
      console.error(e);
      toast('Export failed');
      statusEl.className = 'psr-status err';
      statusEl.textContent = (e && e.message) ? e.message : String(e);
    }
  }

  function clearAll() {
    if (boxesIn) boxesIn.value = '';
    if (intraIn) intraIn.value = '';
    if (rawIn) rawIn.value = '';
    if (execIn) execIn.value = '';
    report = null;
    openPacker = null;
    viewsEl.hidden = true;
    panelEl.innerHTML = '';
    refreshReadyState();
  }

  [boxesIn, intraIn, rawIn, execIn].forEach(function (inp) {
    if (!inp) return;
    inp.addEventListener('change', function () {
      report = null;
      viewsEl.hidden = true;
      panelEl.innerHTML = '';
      refreshReadyState();
    });
  });
  runBtn.addEventListener('click', function () { run(); });
  if (exportBtn) exportBtn.addEventListener('click', downloadExport);
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
