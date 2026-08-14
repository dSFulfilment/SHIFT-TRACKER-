/**
 * Packer tab UI — Boxes + Intra Hour + Raw Data pickers + Morning / Afternoon / Mixed.
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
      statusEl.className = 'psr-status';
      statusEl.textContent = parts.join(' · ') +
        (hasBoxes && hasIntra
          ? ' → click Build report' + (hasRaw ? '' : ' (Raw Data optional for Mixed SKUs)')
          : ' → select Boxes + Intra Hour (+ Raw Data for Mixed), then Build report');
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

  function renderSkuMixDetail(r) {
    var mix = r.skuMix;
    if (!mix || !mix.parts || !mix.parts.length) {
      return '<h3 class="psr-detail-h">SKU mix</h3><p class="psr-prose">No SKUs.</p>';
    }
    var html = '<h3 class="psr-detail-h">SKU mix</h3>';
    if (mix.isMixed) {
      html += '<p class="psr-why"><b>Mixed SKUs</b> — ' + escapeHtml(mix.label) +
        ' (' + mix.count + ' SKUs this shift).</p>';
    } else {
      html += '<p class="psr-why">Single SKU — ' + escapeHtml(mix.label) + '.</p>';
    }
    html += '<table class="psr-table"><thead><tr>' +
      '<th>SKU</th><th>Hours</th><th>% of hours</th><th>Boxes</th><th>% of boxes</th>' +
      '</tr></thead><tbody>';
    mix.parts.forEach(function (p) {
      html += '<tr' + (mix.isMixed ? ' class="psr-mix-row"' : '') + '>' +
        '<td>' + escapeHtml(p.sku) + (p.unknownSku ? ' <em>(no target)</em>' : '') + '</td>' +
        '<td>' + p.hours.toFixed(2) + '</td>' +
        '<td>' + (p.hoursShare != null ? p.hoursShare.toFixed(0) + '%' : '—') + '</td>' +
        '<td>' + Math.round(p.boxes).toLocaleString() + '</td>' +
        '<td>' + (p.boxesShare != null ? p.boxesShare.toFixed(0) + '%' : '—') + '</td>' +
        '</tr>';
    });
    html += '<tr class="psr-total-row">' +
      '<td><b>Total</b></td>' +
      '<td><b>' + mix.totalHours.toFixed(2) + '</b></td>' +
      '<td><b>100%</b></td>' +
      '<td><b>' + Math.round(mix.totalBoxes).toLocaleString() + '</b></td>' +
      '<td><b>100%</b></td>' +
      '</tr>';
    html += '</tbody></table>';
    return html;
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
    html += '<tr class="psr-total-row"><td><b>Total</b></td><td><b>' + Math.round(total).toLocaleString() + '</b></td></tr>';
    html += '</tbody></table>';
    return html;
  }

  function renderSkuDetail(r) {
    var html = '<h3 class="psr-detail-h">SKU performance</h3>';
    if (r.why) html += '<p class="psr-why">' + escapeHtml(r.why || '') + '</p>';
    if (!r.skuLines || !r.skuLines.length) {
      return html + '<p class="psr-prose">No SKU lines.</p>';
    }

    var totHours = 0;
    var totBoxes = 0;
    var knownHours = 0;
    var knownTargetBoxes = 0;
    var knownStrikeHours = 0;
    var knownStrikeWeight = 0;
    r.skuLines.forEach(function (L) {
      if (L.verdict && String(L.verdict).indexOf('excluded') === 0) return;
      totHours += L.hours || 0;
      totBoxes += L.boxes || 0;
      if (L.targetBph != null && L.hours != null) {
        knownHours += L.hours;
        knownTargetBoxes += L.hours * L.targetBph;
      }
      if (L.strikeBph != null && L.hours != null) {
        knownStrikeHours += L.hours;
        knownStrikeWeight += L.hours * L.strikeBph;
      }
    });
    var avgBph = totHours > 0 ? totBoxes / totHours : null;
    var avgTarget = knownHours > 0 ? knownTargetBoxes / knownHours : null;
    var avgStrike = knownStrikeHours > 0 ? knownStrikeWeight / knownStrikeHours : null;
    var overallPct = r.pctOfTarget != null
      ? r.pctOfTarget
      : (knownTargetBoxes > 0 ? (totBoxes / knownTargetBoxes * 100) : null);

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
    html += '<tr class="psr-total-row">' +
      '<td><b>Total / avg</b></td>' +
      '<td><b>' + totHours.toFixed(2) + '</b></td>' +
      '<td><b>' + Math.round(totBoxes).toLocaleString() + '</b></td>' +
      '<td><b>' + (avgBph != null ? avgBph.toFixed(1) : '—') + '</b></td>' +
      '<td><b>' + (avgTarget != null ? avgTarget.toFixed(1) : '—') + '</b></td>' +
      '<td><b>' + (avgStrike != null ? avgStrike.toFixed(1) : '—') + '</b></td>' +
      '<td><b>' + (overallPct != null ? overallPct.toFixed(0) + '%' : '—') + '</b></td>' +
      '<td><b>' + escapeHtml(r.flag || '—') + '</b></td>' +
      '</tr>';
    html += '</tbody></table>';
    html += '<p class="psr-prose psr-note">Total hours = all SKU hours this shift. Avg BPH = total boxes ÷ total hours. Avg target/strike are hours-weighted. Line % on the total row is overall % of target.</p>';
    return html;
  }

  function renderRawLines(r) {
    var lines = r.rawLines || [];
    var mixed = r.skuMix && r.skuMix.isMixed;
    var html = '<h3 class="psr-detail-h">Raw Boxes lines' +
      (mixed ? ' <span class="psr-mixed">Mixed</span>' : '') + '</h3>';
    if (!lines.length) {
      return html + '<p class="psr-prose">No raw lines.</p>';
    }
    if (mixed) {
      html += '<p class="psr-why">Full Boxes Packed rows for this packer/shift — use this to see each SKU, station, and packing seconds behind the mix.</p>';
    }
    html += '<table class="psr-table"><thead><tr>' +
      '<th>Station</th><th>SKU</th><th>Boxes</th><th>Packing sec</th><th>Hours</th>' +
      '<th>Actual BPH</th><th>Target</th><th>Strike</th><th>SPI</th><th>Note</th>' +
      '</tr></thead><tbody>';
    var totH = 0;
    var totB = 0;
    lines.forEach(function (L) {
      if (L.included) {
        totH += L.hours || 0;
        totB += L.boxes || 0;
      }
      html += '<tr class="' + verdictClass(
        !L.included ? 'excluded' :
          (L.unknownSku ? 'no target' :
            (L.actualBph != null && L.strikeBph != null && L.actualBph < L.strikeBph ? 'under strike' :
              (L.actualBph != null && L.targetBph != null && L.actualBph < L.targetBph ? 'under target' : 'on/above target')))
      ) + '">' +
        '<td>' + escapeHtml(L.station == null ? '' : L.station) + '</td>' +
        '<td>' + escapeHtml(L.sku) + '</td>' +
        '<td>' + (L.boxes != null ? Math.round(L.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (L.packingSeconds != null ? Math.round(L.packingSeconds).toLocaleString() : '—') + '</td>' +
        '<td>' + (L.hours != null ? L.hours.toFixed(2) : '—') + '</td>' +
        '<td>' + (L.actualBph != null ? L.actualBph.toFixed(1) : '—') + '</td>' +
        '<td>' + (L.targetBph != null ? L.targetBph : '—') + '</td>' +
        '<td>' + (L.strikeBph != null ? L.strikeBph : '—') + '</td>' +
        '<td>' + (L.secondsPerItem != null ? L.secondsPerItem : '—') + '</td>' +
        '<td>' + escapeHtml(L.excludeReason || (L.unknownSku ? 'no target' : '')) + '</td>' +
        '</tr>';
    });
    html += '<tr class="psr-total-row">' +
      '<td colspan="2"><b>Total / avg</b></td>' +
      '<td><b>' + Math.round(totB).toLocaleString() + '</b></td>' +
      '<td></td>' +
      '<td><b>' + totH.toFixed(2) + '</b></td>' +
      '<td><b>' + (totH > 0 ? (totB / totH).toFixed(1) : '—') + '</b></td>' +
      '<td colspan="4"></td>' +
      '</tr>';
    html += '</tbody></table>';
    return html;
  }

  function renderRawDataSegments(r) {
    var segs = r.rawDataSegments || [];
    if (!segs.length) return '';
    var mixedSegs = segs.filter(function (s) { return s.isMixed; });
    var html = '<h3 class="psr-detail-h">Raw Data <span class="psr-mixed">Box Sku Sizes</span></h3>';
    html += '<p class="psr-why">From the Raw Data export. Mixed when <b>Box Sku Sizes</b> lists more than one SKU (e.g. 250g, 600g).</p>';
    html += '<table class="psr-table"><thead><tr>' +
      '<th>Box Sku Sizes</th><th>Mixed?</th><th>Boxes</th><th>Packing sec</th><th>Hours</th><th>BPH</th><th>First Scan</th><th>Last Scan</th>' +
      '</tr></thead><tbody>';
    segs.forEach(function (s) {
      html += '<tr' + (s.isMixed ? ' class="psr-mix-row"' : '') + '>' +
        '<td>' + escapeHtml(s.boxSkuSizes || '') + '</td>' +
        '<td>' + (s.isMixed ? '<span class="psr-mixed">Yes</span>' : 'No') + '</td>' +
        '<td>' + (s.boxes != null ? Math.round(s.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (s.packingSeconds != null ? Math.round(s.packingSeconds).toLocaleString() : '—') + '</td>' +
        '<td>' + (s.hours != null ? s.hours.toFixed(3) : '—') + '</td>' +
        '<td>' + (s.actualBph != null ? s.actualBph.toFixed(1) : '—') + '</td>' +
        '<td>' + escapeHtml(s.firstScan == null ? '' : s.firstScan) + '</td>' +
        '<td>' + escapeHtml(s.lastScan == null ? '' : s.lastScan) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    if (mixedSegs.length) {
      html += '<p class="psr-prose psr-note">' + mixedSegs.length + ' mixed segment' +
        (mixedSegs.length === 1 ? '' : 's') + ' for this packer in Raw Data.</p>';
    }
    return html;
  }

  function renderPackerDetail(r) {
    return '<div class="psr-packer-detail">' +
      renderSkuMixDetail(r) +
      renderRawDataSegments(r) +
      renderRawLines(r) +
      renderHourDetail(r) +
      renderSkuDetail(r) +
      '</div>';
  }

  function mixCell(r) {
    var mix = r.skuMix;
    if (!mix) return '—';
    if (mix.isMixed) {
      return '<span class="psr-mixed">Mixed</span> ' + escapeHtml(mix.label);
    }
    return escapeHtml(mix.label);
  }

  function renderShiftTable(rows, totals) {
    if (!rows.length) {
      return '<p class="psr-prose">No packers for this shift in the Boxes export.</p>';
    }
    var mixedN = rows.filter(function (r) { return r.skuMix && r.skuMix.isMixed; }).length;
    var html = renderTotals(totals);
    html += '<p class="psr-prose">Click a packer for SKU mix, Raw Data sizes, boxes each hour, and SKU performance. ' +
      '<b>' + mixedN + '</b> packer' + (mixedN === 1 ? '' : 's') + ' with multiple Primary Sku lines this shift.</p>';
    html += '<table class="psr-table"><thead><tr>' +
      '<th>Packer</th><th>SKU mix</th><th>Hours</th><th>Boxes</th><th>Target</th><th>%</th><th>Gap</th><th>Flag</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r, idx) {
      var open = openPacker === r.workerDisplay;
      html += '<tr class="' + flagClass(r.flag) + ' psr-row" data-packer="' + escapeHtml(r.workerDisplay) + '" data-idx="' + idx + '" style="cursor:pointer">' +
        '<td><b>' + escapeHtml(r.workerDisplay) + '</b>' + (open ? ' ▾' : ' ▸') + '</td>' +
        '<td>' + mixCell(r) + '</td>' +
        '<td>' + (r.hours != null ? r.hours.toFixed(2) : '—') + '</td>' +
        '<td>' + (r.boxes != null ? Math.round(r.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (r.targetBoxes != null ? r.targetBoxes.toFixed(1) : '—') + '</td>' +
        '<td>' + (r.pctOfTarget != null ? r.pctOfTarget.toFixed(1) + '%' : '—') + '</td>' +
        '<td>' + (r.boxGap != null ? ((r.boxGap >= 0 ? '+' : '') + Math.round(r.boxGap)) : '—') + '</td>' +
        '<td>' + escapeHtml(r.flag) + '</td>' +
        '</tr>';
      if (open) {
        html += '<tr class="psr-detail"><td colspan="8">' + renderPackerDetail(r) + '</td></tr>';
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
    var html = '<p class="psr-prose">Boxes packed each clock hour. SKU mix is for the whole shift (Intra has no SKU column).</p>';
    rows.forEach(function (H) {
      html += '<div class="psr-hour-block">' +
        '<div class="psr-hour-head"><b>' + escapeHtml(H.hourLabel) + '</b> · ' +
        escapeHtml(H.shiftLabel) + ' · ' + Math.round(H.boxes).toLocaleString() + ' boxes · ' +
        H.packers.length + ' packer' + (H.packers.length === 1 ? '' : 's') + '</div>';
      html += '<table class="psr-table"><thead><tr><th>Packer</th><th>Boxes this hour</th><th>SKU mix (shift)</th></tr></thead><tbody>';
      H.packers.forEach(function (p) {
        var info = p.skuInfo || {};
        var mix = info.mix;
        var mixTxt = '—';
        if (mix) {
          mixTxt = mix.isMixed
            ? ('Mixed: ' + mix.label)
            : ('SKU ' + mix.label);
        }
        html += '<tr>' +
          '<td><b>' + escapeHtml(p.workerDisplay) + '</b></td>' +
          '<td>' + Math.round(p.boxes).toLocaleString() + '</td>' +
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

  function renderMixedWorkerBlock(w) {
    var html = '<div class="psr-hour-block">' +
      '<div class="psr-hour-head"><span class="psr-mixed">Mixed</span> <b>' +
      escapeHtml(w.workerDisplay) + '</b> · ' + escapeHtml(w.mixLabel || '') +
      ' · ' + w.segmentCount + ' segment' + (w.segmentCount === 1 ? '' : 's') +
      ' · ' + (w.hours != null ? w.hours.toFixed(2) + 'h' : '—') +
      ' · ' + Math.round(w.boxes || 0).toLocaleString() + ' boxes</div>';
    html += '<table class="psr-table"><thead><tr>' +
      '<th>Box Sku Sizes</th><th>Boxes</th><th>Packing sec</th><th>Hours</th><th>BPH</th>' +
      '<th>First Scan</th><th>Last Scan</th><th>Shift guess</th>' +
      '</tr></thead><tbody>';
    (w.segments || []).forEach(function (seg) {
      html += '<tr class="psr-mix-row">' +
        '<td>' + escapeHtml(seg.boxSkuSizes || '') + '</td>' +
        '<td>' + (seg.boxes != null ? Math.round(seg.boxes).toLocaleString() : '—') + '</td>' +
        '<td>' + (seg.packingSeconds != null ? Math.round(seg.packingSeconds).toLocaleString() : '—') + '</td>' +
        '<td>' + (seg.hours != null ? seg.hours.toFixed(3) : '—') + '</td>' +
        '<td>' + (seg.actualBph != null ? seg.actualBph.toFixed(1) : '—') + '</td>' +
        '<td>' + escapeHtml(seg.firstScan == null ? '' : seg.firstScan) + '</td>' +
        '<td>' + escapeHtml(seg.lastScan == null ? '' : seg.lastScan) + '</td>' +
        '<td>' + escapeHtml(seg.shiftLabel || '') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderMixed() {
    var mixed = report.rawDataMixed || [];
    var rawRows = report.rawDataRows || [];
    if (!rawRows.length) {
      return '<p class="psr-prose">Select the <b>Raw Data</b> export (CSV/xlsx with <b>Box Sku Sizes</b>) and Build report to see mixed SKUs here. Boxes Packed alone cannot show true mixed sizes.</p>';
    }
    if (!mixed.length) {
      return '<p class="psr-prose">Raw Data loaded (' + rawRows.length + ' rows) — no mixed <b>Box Sku Sizes</b> (e.g. "250g, 600g") in this file.</p>';
    }
    var totBoxes = mixed.reduce(function (s, w) { return s + (w.boxes || 0); }, 0);
    var html = '<p class="psr-prose"><b>' + mixed.length + '</b> packer' + (mixed.length === 1 ? '' : 's') +
      ' with mixed Box Sku Sizes · ' + Math.round(totBoxes).toLocaleString() +
      ' boxes across mixed segments. Source: Raw Data export.</p>';
    mixed.forEach(function (w) {
      html += renderMixedWorkerBlock(w);
    });
    return html;
  }

  function renderHow() {
    return '<div class="psr-prose">' +
      '<h2>Files</h2>' +
      '<p>Pick <b>Boxes Packed by Worker</b>, <b>Intra Hour Floor Performance</b>, and optionally <b>Raw Data</b> (for Mixed SKUs via Box Sku Sizes), then <b>Build report</b>.</p>' +
      '<h2>Mixed SKUs</h2>' +
      '<p>The <b>Mixed SKUs</b> tab uses the Raw Data export column <b>Box Sku Sizes</b> (e.g. "250g, 600g"). Scoring still comes from Boxes Packed. Intra Hour is boxes per clock hour only (no SKU).</p>' +
      '<h2>Export</h2>' +
      '<p>After Build report, click <b>Export report</b> for Excel: Summary, shifts, SKU detail, Mixed SKUs, Raw Data export, Boxes raw lines, By hour, Exclusions, SKU targets.</p>' +
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
    else if (view === 'mixed') panelEl.innerHTML = renderMixed();
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
      var rawFile = (rawIn && rawIn.files && rawIn.files[0]) ? rawIn.files[0] : null;
      report = await PSR.buildReportFromFiles(boxesIn.files[0], intraIn.files[0], rawFile);
      var mixedN = (report.rawDataMixed || []).length;
      var bits = [
        'Morning: ' + report.morning.length + ' packers',
        'Afternoon: ' + report.afternoon.length + ' packers',
        'Raw lines: ' + report.rawLines.length
      ];
      if (report.rawDataRows && report.rawDataRows.length) {
        bits.push('Raw Data: ' + report.rawDataRows.length + ' rows · mixed ' + mixedN);
      } else {
        bits.push('Raw Data: not loaded');
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
    report = null;
    openPacker = null;
    viewsEl.hidden = true;
    panelEl.innerHTML = '';
    refreshReadyState();
  }

  [boxesIn, intraIn, rawIn].forEach(function (inp) {
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
