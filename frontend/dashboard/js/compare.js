/* COMPARE — across different rooms (same metric) | within one room (all sensors) | cross two rooms */
function initCompare(DATA) {
  const modeTabs = document.getElementById('compareModeTabs');
  const roomSelectEl = document.getElementById('compareRoomSelect');
  const roomSelectElB = document.getElementById('compareRoomSelectB');
  const compareTabs = document.getElementById('compareTabs');
  const legendEl = document.getElementById('compareLegend');
  const controlsEl = document.getElementById('compareControls');
  const chartCard = document.querySelector('#page-compare .card'); // single-chart card
  const roomGridEl = document.getElementById('compareRoomGrid');
  const crossGridEl = document.getElementById('compareRoomCrossGrid');
  const hintEl = document.getElementById('compareHint');

  let metrics = Object.keys(DATA.compare.byMetric);
  let rooms = DATA.compare.rooms;

  // Ordered, de-duplicated list of DC names as they appear in the room data
  let dcNames = [...new Set(rooms.map(r => r.dc_name))];
  // Consistent room-type order used to pick a shade variant
  const ROOM_ORDER = ['101', '201', 'B01', '102'];

  let mode = 'across'; // 'across' | 'within' | 'cross'
  let currentMetric = metrics[0];
  let currentRoomId = rooms[0].id;
  let currentRoomIdB = rooms.length > 1 ? rooms[1].id : rooms[0].id;
  let compareChart = null;
  let roomCharts = [];
  let crossCharts = [];
  let crossChartLabels = [];
  let searchTerm = '';

  // Legend is grouped by DATA CENTER (6 chips), not by room.
  let visibleDCs = new Set(['DC-Epsilon']); // default: just the active-anomaly site
  let hiddenRoomKeys = new Set(); // specific rooms toggled off in room key

  const PALETTE = ['#4D774E', '#F1B24A', '#7A9E8E', '#9DC88D', '#164A41', '#B98A3E'];

  // Distinct room colors used when viewing rooms within a single DC or comparing rooms
  const ROOM_COLORS = {
    '101': '#52B79A', // Emerald / Teal (Server Room A)
    '201': '#F1B24A', // Warm Amber / Gold (Server Room B)
    'B01': '#E66565', // Coral / Rose Red (Mechanical Room)
    '102': '#4EA8DE', // Sky Blue / Cyan (Electrical Room)
  };
  const ROOM_FALLBACK_COLORS = ['#52B79A', '#F1B24A', '#E66565', '#4EA8DE', '#A78BFA', '#FB923C'];

  // Distinct line stroke dash styles so overlapping lines are instantly distinguishable
  const ROOM_DASH = {
    '101': [],            // Solid
    '201': [6, 4],        // Dashed
    'B01': [2, 3],        // Dotted
    '102': [10, 4, 2, 4]  // Dash-dot
  };

  // Two distinct colors used for cross-room overlays (Room A / Room B)
  const CROSS_COLOR_A = '#52B79A';  // teal-green
  const CROSS_COLOR_B = '#F1B24A';  // amber

  /* ---- color helpers ---- */
  function hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }
  function colorForDC(dcName) {
    if (dcName === 'DC-Epsilon') return '#E66565';
    const idx = dcNames.filter(n => n !== 'DC-Epsilon').indexOf(dcName);
    return PALETTE[idx % PALETTE.length];
  }
  function colorForRoom(dcName, roomCode, isSingleDC = false) {
    if (isSingleDC) {
      if (ROOM_COLORS[roomCode]) return ROOM_COLORS[roomCode];
      const idx = ROOM_ORDER.indexOf(roomCode);
      return ROOM_FALLBACK_COLORS[(idx === -1 ? 0 : idx) % ROOM_FALLBACK_COLORS.length];
    }
    const base = colorForDC(dcName);
    const [h, s, l] = hexToHsl(base);
    const variantIdx = ROOM_ORDER.indexOf(roomCode);
    const idx = variantIdx === -1 ? 0 : variantIdx;
    const lightnessSteps = [l - 12, l + 6, l + 18, l - 4];
    const satSteps = [s, s - 6, s + 8, s - 12];
    const newL = Math.max(22, Math.min(80, lightnessSteps[idx % 4]));
    const newS = Math.max(30, Math.min(95, satSteps[idx % 4]));
    return hslToHex(h, newS, newL);
  }
  function dashForRoom(roomCode) {
    return ROOM_DASH[roomCode] || [];
  }

  /* ---- tab rendering ---- */
  function renderModeTabs() {
    modeTabs.innerHTML = `
      <button class="metric-tab ${mode === 'across' ? 'active' : ''}" data-mode="across">Across rooms</button>
      <button class="metric-tab ${mode === 'within' ? 'active' : ''}" data-mode="within">Within a room</button>
      <button class="metric-tab ${mode === 'cross' ? 'active' : ''}" data-mode="cross">Cross room</button>
    `;
    modeTabs.querySelectorAll('.metric-tab').forEach(btn => {
      btn.addEventListener('click', () => { mode = btn.dataset.mode; resetDefaults(); renderAll(); });
    });
  }

  /* ---- room selectors ---- */
  function buildRoomOptions() {
    return dcNames.map(dc => {
      const dcRooms = rooms.filter(r => r.dc_name === dc);
      const options = dcRooms.map(r =>
        `<option value="${r.id}">Room ${r.room_code} — ${r.name} (${dc})</option>`
      ).join('');
      return `<optgroup label="${dc}">${options}</optgroup>`;
    }).join('');
  }

  function renderRoomSelect() {
    // Room A selector — shown in 'within' and 'cross' modes
    const showA = mode === 'within' || mode === 'cross';
    roomSelectEl.style.display = showA ? 'inline-block' : 'none';
    if (showA) {
      roomSelectEl.innerHTML = buildRoomOptions();
      roomSelectEl.value = currentRoomId;
      // Add label only for cross mode
      roomSelectEl.title = mode === 'cross' ? 'Room A' : '';
      roomSelectEl.style.borderLeft = mode === 'cross' ? `3px solid ${CROSS_COLOR_A}` : '';
    }

    // Room B selector — only in 'cross' mode
    const showB = mode === 'cross';
    roomSelectElB.style.display = showB ? 'inline-block' : 'none';
    if (showB) {
      roomSelectElB.innerHTML = buildRoomOptions();
      roomSelectElB.value = currentRoomIdB;
      roomSelectElB.title = 'Room B';
      roomSelectElB.style.borderLeft = `3px solid ${CROSS_COLOR_B}`;
    }
  }

  /* ============================================================
     Mode: Across rooms (same metric, overlaid line chart)
  ============================================================ */
  function renderAcrossTabs() {
    compareTabs.innerHTML = metrics.map(m => `
      <button class="metric-tab ${m === currentMetric ? 'active' : ''}" data-metric="${m}">${m.replace('_', ' ')}</button>
    `).join('');
    compareTabs.querySelectorAll('.metric-tab').forEach(btn => {
      btn.addEventListener('click', () => { currentMetric = btn.dataset.metric; resetDefaults(); renderAcrossChart(); renderAcrossTabs(); });
    });
  }

  function allDCsVisible() { return dcNames.every(n => visibleDCs.has(n)); }

  function renderControls() {
    const restoreSearchFocus = document.activeElement?.id === 'cmpSearch';
    const selectionStart = restoreSearchFocus ? document.activeElement.selectionStart : null;
    const selectionEnd = restoreSearchFocus ? document.activeElement.selectionEnd : null;
    controlsEl.innerHTML = `
      <input id="cmpSearch" type="text" placeholder="Search rooms or sites…" class="chart-btn" style="min-width:180px;text-align:left;cursor:text" value="${searchTerm}">
      <button class="chart-btn" id="cmpShowAll">${allDCsVisible() ? 'Show fewer' : 'Show all'}</button>
      <button class="chart-btn" id="cmpZoomIn">Zoom in</button>
      <button class="chart-btn" id="cmpZoomOut">Zoom out</button>
      <button class="chart-btn" id="cmpReset">Reset view</button>
    `;
    document.getElementById('cmpZoomIn').onclick = () => compareChart.zoom(1.3);
    document.getElementById('cmpZoomOut').onclick = () => compareChart.zoom(0.7);
    document.getElementById('cmpReset').onclick = () => compareChart.resetZoom();
    document.getElementById('cmpShowAll').onclick = () => {
      visibleDCs = allDCsVisible() ? new Set(['DC-Epsilon']) : new Set(dcNames);
      renderAcrossChart();
      renderControls();
    };

    const searchInput = document.getElementById('cmpSearch');
    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value;
      renderAcrossChart();
    });
    if (restoreSearchFocus) {
      searchInput.focus();
      searchInput.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  function computeVisibility(series) {
    const term = searchTerm.trim().toLowerCase();
    if (term) return series.map(s => ({ ...s, visible: s.label.toLowerCase().includes(term) }));
    return series.map(s => ({ ...s, visible: visibleDCs.has(s.dc_name) }));
  }

  function renderAcrossChart() {
    const rawSeries = DATA.compare.byMetric[currentMetric] || [];
    const series = computeVisibility(rawSeries);
    const labels = rawSeries.length > 0 ? rawSeries[0].history.map((_, i) => i) : [];
    const unit = rawSeries.length > 0 ? rawSeries[0].unit : '';
    const visibleRooms = series.filter(s => s.visible);
    const visibleRoomCount = visibleRooms.length;
    const visibleDCCount = new Set(visibleRooms.map(s => s.dc_name)).size;
    const isSingleDC = visibleDCCount === 1;

    if (compareChart) compareChart.destroy();
    const ctx = document.getElementById('compareChart').getContext('2d');
    compareChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => {
          const color = colorForRoom(s.dc_name, s.room_code, isSingleDC);
          const dash = isSingleDC ? dashForRoom(s.room_code) : [];
          const isRoomHidden = hiddenRoomKeys.has(s.key);
          return {
            label: s.label,
            data: s.history,
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: dash,
            pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12,
            tension: 0.3,
            hidden: !s.visible || isRoomHidden
          };
        })
      },
      options: {
        responsive: true,
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#16261F', titleColor: '#EAF3EC', bodyColor: '#EAF3EC',
            padding: 10, cornerRadius: 6,
            callbacks: { title: () => '', label: (c) => `${c.dataset.label}: ${c.formattedValue} ${unit}` }
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: false }, mode: 'x' }
          }
        },
        scales: {
          x: { display: false },
          y: { grid: { color: cssVar('--border') }, ticks: { font: { size: 11 }, color: cssVar('--text-muted') } }
        }
      }
    });

    const searching = searchTerm.trim().length > 0;
    legendEl.innerHTML = dcNames.map(dc => {
      const isOn = visibleDCs.has(dc) && !searching;
      const roomCount = rooms.filter(r => r.dc_name === dc).length;
      return `
        <span class="legend-chip ${isOn ? '' : 'dimmed'} ${searching ? 'disabled' : ''}" data-dc="${dc}" title="${roomCount} rooms">
          <span class="legend-swatch" style="background:${colorForDC(dc)}"></span>${dc}
        </span>
      `;
    }).join('');
    if (!searching) {
      legendEl.querySelectorAll('.legend-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const dc = chip.dataset.dc;
          if (visibleDCs.has(dc)) visibleDCs.delete(dc); else visibleDCs.add(dc);
          hiddenRoomKeys = new Set(); // reset room-level filter on DC toggle
          renderAcrossChart();
          renderControls();
        });
      });
    }

    const roomKeyEl = document.getElementById('compareRoomKey');
    if (roomKeyEl) {
      if (visibleRoomCount > 0 && visibleRoomCount <= 8) {
        roomKeyEl.style.display = 'flex';
        // Map visible series index back to full datasets index for chart interaction
        const visibleSeriesMap = series.reduce((acc, s, di) => {
          if (s.visible) acc.push({ s, di });
          return acc;
        }, []);

        roomKeyEl.innerHTML = visibleSeriesMap.map(({ s }) => {
          const color = colorForRoom(s.dc_name, s.room_code, isSingleDC);
          const dash = isSingleDC ? dashForRoom(s.room_code) : [];
          const dashPreview = dash.length === 0
            ? `<svg width="22" height="4" style="margin-right:6px;flex-shrink:0"><line x1="0" y1="2" x2="22" y2="2" stroke="${color}" stroke-width="2.5"/></svg>`
            : `<svg width="22" height="4" style="margin-right:6px;flex-shrink:0"><line x1="0" y1="2" x2="22" y2="2" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash.join(' ')}"/></svg>`;
          const isHidden = hiddenRoomKeys.has(s.key);
          return `
            <span class="legend-chip room-chip ${isHidden ? 'dimmed' : ''}" data-room-key="${s.key}" title="Click to show/hide · hover to highlight">
              ${dashPreview}${s.label}
            </span>
          `;
        }).join('');

        // Hover: dim all other datasets, brighten hovered one
        roomKeyEl.querySelectorAll('.room-chip').forEach(chip => {
          chip.addEventListener('mouseenter', () => {
            const hoveredKey = chip.dataset.roomKey;
            compareChart.data.datasets.forEach((ds, di) => {
              const entry = visibleSeriesMap.find(e => e.di === di);
              if (!entry) return;
              const isTarget = entry.s.key === hoveredKey;
              const baseColor = colorForRoom(entry.s.dc_name, entry.s.room_code, isSingleDC);
              ds.borderWidth = isTarget ? 3 : 1;
              ds.borderColor = isTarget ? baseColor : hexToRgba(baseColor, 0.18);
            });
            compareChart.update('none');
          });
          chip.addEventListener('mouseleave', () => {
            compareChart.data.datasets.forEach((ds, di) => {
              const entry = visibleSeriesMap.find(e => e.di === di);
              if (!entry) return;
              ds.borderWidth = 2;
              ds.borderColor = colorForRoom(entry.s.dc_name, entry.s.room_code, isSingleDC);
            });
            compareChart.update('none');
          });
          // Click: toggle this room's visibility
          chip.addEventListener('click', () => {
            const key = chip.dataset.roomKey;
            const currentlyHidden = hiddenRoomKeys.has(key);
            const visibleCount = visibleSeriesMap.filter(e => !hiddenRoomKeys.has(e.s.key)).length;
            // Don't allow hiding the last visible room
            if (!currentlyHidden && visibleCount <= 1) return;
            if (currentlyHidden) hiddenRoomKeys.delete(key); else hiddenRoomKeys.add(key);
            renderAcrossChart();
          });
        });

      } else {
        roomKeyEl.style.display = 'none';
        roomKeyEl.innerHTML = '';
      }
    }

    const rangeLine = document.getElementById('compareRangeLine');
    if (rangeLine) {
      const visLabel = searching
        ? `${visibleRoomCount} room match${visibleRoomCount !== 1 ? 'es' : ''} for "${searchTerm.trim()}"`
        : `Showing ${visibleDCCount} of ${dcNames.length} sites (${visibleRoomCount} rooms)`;
      rangeLine.textContent = `${currentMetric.replace('_', ' ')} · ${visLabel}${series.some(s => s.dc_name === 'DC-Epsilon' && s.visible) ? ' · includes DC-Epsilon (active anomaly)' : ''}`;
    }
  }

  /* ============================================================
     Mode: Within a room (small multiples, one chart per sensor)
  ============================================================ */
  function renderWithinRoom() {
    roomCharts.forEach(c => c.destroy());
    roomCharts = [];

    const room = DATA.compare.byRoom[currentRoomId];
    if (!room) { roomGridEl.innerHTML = ''; return; }

    roomGridEl.innerHTML = `
      <h3 style="margin:0 0 4px">${room.room_label}</h3>
      <p class="chart-hint" style="margin:0 0 16px">${room.sensors.length} sensor${room.sensors.length !== 1 ? 's' : ''} in this room — each measures a different metric, shown on its own scale.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
        ${room.sensors.map(s => `
          <div>
            <p style="margin:0 0 6px;font-size:13px;font-weight:600">${s.name.replace(' Sensor 1', '')} <span style="font-weight:400;color:var(--text-muted)">(${s.unit})</span></p>
            <canvas id="roomChart-${s.sensor_code}" height="140"></canvas>
          </div>
        `).join('')}
      </div>
    `;

    room.sensors.forEach((s, i) => {
      const ctx = document.getElementById(`roomChart-${s.sensor_code}`).getContext('2d');
      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: s.history.map((_, idx) => idx),
          datasets: [{
            data: s.history,
            borderColor: PALETTE[i % PALETTE.length],
            backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: 0, tension: 0.3
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => `${c.formattedValue} ${s.unit}` } }
          },
          scales: {
            x: { display: false },
            y: { grid: { color: cssVar('--border') }, ticks: { font: { size: 10 }, color: cssVar('--text-muted') } }
          }
        }
      });
      roomCharts.push(chart);
    });
  }

  /* ============================================================
     Mode: Cross room — pick two rooms, overlay shared metrics
  ============================================================ */

  /**
   * Collect sensor data for a given room from DATA.compare.byRoom,
   * keyed by metric_type.
   */
  function sensorsForRoom(roomId) {
    const room = DATA.compare.byRoom[roomId];
    if (!room) return {};
    const out = {};
    room.sensors.forEach(s => { out[s.metric_type] = s; });
    return out;
  }

  function statLabel(history) {
    if (!history || history.length === 0) return { current: '—', avg: '—', min: '—', max: '—' };
    const current = history[history.length - 1];
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
    return { current: fmt(current), avg: fmt(avg), min: fmt(min), max: fmt(max) };
  }

  function renderCrossRoom() {
    crossCharts.forEach(c => c.destroy());
    crossCharts = [];
    crossChartLabels = [];

    const roomA = DATA.compare.byRoom[currentRoomId];
    const roomB = DATA.compare.byRoom[currentRoomIdB];
    if (!roomA || !roomB) { crossGridEl.innerHTML = ''; return; }

    const sensorsA = sensorsForRoom(currentRoomId);
    const sensorsB = sensorsForRoom(currentRoomIdB);

    // Only metrics present in BOTH rooms
    const sharedMetrics = metrics.filter(m => sensorsA[m] && sensorsB[m]);

    if (sharedMetrics.length === 0) {
      crossGridEl.innerHTML = `
        <div class="card" style="text-align:center;padding:32px">
          <p style="color:var(--text-muted);margin:0">No shared metrics between the two selected rooms.</p>
        </div>
      `;
      return;
    }

    // Header row showing which rooms are being compared
    const headerHtml = `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;flex-wrap:wrap">
        <span style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${CROSS_COLOR_A};flex-shrink:0"></span>
          Room A — ${roomA.room_label}
        </span>
        <span style="color:var(--text-muted);font-size:20px;line-height:1">vs</span>
        <span style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${CROSS_COLOR_B};flex-shrink:0"></span>
          Room B — ${roomB.room_label}
        </span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${sharedMetrics.length} shared metric${sharedMetrics.length !== 1 ? 's' : ''}</span>
      </div>
    `;

    // One card per shared metric
    const cardsHtml = sharedMetrics.map(metric => {
      const sA = sensorsA[metric];
      const sB = sensorsB[metric];
      const unit = sA.unit;
      const chartId = `crossChart-${metric}`;

      const stA = statLabel(sA.history);
      const stB = statLabel(sB.history);

      const metricDisplay = metric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header" style="margin-bottom:12px">
            <h2 style="text-transform:capitalize">${metricDisplay}</h2>
            <span class="meta">${unit}</span>
          </div>
          <canvas id="${chartId}" height="90"></canvas>

          <!-- Mini stats comparison table -->
          <div style="margin-top:16px;overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr>
                  <th style="text-align:left;padding:6px 10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);font-size:10px;width:26%">Room</th>
                  <th style="padding:6px 10px;text-align:right;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);font-size:10px">Current</th>
                  <th style="padding:6px 10px;text-align:right;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);font-size:10px">Avg</th>
                  <th style="padding:6px 10px;text-align:right;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);font-size:10px">Min</th>
                  <th style="padding:6px 10px;text-align:right;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);font-size:10px">Max</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding:7px 10px;border-bottom:1px solid var(--border)">
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <span style="width:8px;height:8px;border-radius:50%;background:${CROSS_COLOR_A};flex-shrink:0;display:inline-block"></span>
                      <span style="font-weight:500;color:var(--text-primary)">${roomA.room_name || 'Room A'}</span>
                    </span>
                    <div style="font-size:10px;color:var(--text-muted);padding-left:14px">${roomA.dc_name}</div>
                  </td>
                  <td style="padding:7px 10px;text-align:right;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-weight:600;color:var(--text-primary)">${stA.current} <span style="font-weight:400;color:var(--text-muted)">${unit}</span></td>
                  <td style="padding:7px 10px;text-align:right;border-bottom:1px solid var(--border);font-family:var(--font-mono);color:var(--text-secondary)">${stA.avg}</td>
                  <td style="padding:7px 10px;text-align:right;border-bottom:1px solid var(--border);font-family:var(--font-mono);color:var(--text-secondary)">${stA.min}</td>
                  <td style="padding:7px 10px;text-align:right;border-bottom:1px solid var(--border);font-family:var(--font-mono);color:var(--text-secondary)">${stA.max}</td>
                </tr>
                <tr>
                  <td style="padding:7px 10px">
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <span style="width:8px;height:8px;border-radius:50%;background:${CROSS_COLOR_B};flex-shrink:0;display:inline-block"></span>
                      <span style="font-weight:500;color:var(--text-primary)">${roomB.room_name || 'Room B'}</span>
                    </span>
                    <div style="font-size:10px;color:var(--text-muted);padding-left:14px">${roomB.dc_name}</div>
                  </td>
                  <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);font-weight:600;color:var(--text-primary)">${stB.current} <span style="font-weight:400;color:var(--text-muted)">${unit}</span></td>
                  <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:var(--text-secondary)">${stB.avg}</td>
                  <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:var(--text-secondary)">${stB.min}</td>
                  <td style="padding:7px 10px;text-align:right;font-family:var(--font-mono);color:var(--text-secondary)">${stB.max}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    crossGridEl.innerHTML = headerHtml + cardsHtml;

    // Build charts after DOM is injected
    sharedMetrics.forEach(metric => {
      const sA = sensorsA[metric];
      const sB = sensorsB[metric];
      const len = Math.max(sA.history.length, sB.history.length);
      const labels = Array.from({ length: len }, (_, i) => i);

      const ctx = document.getElementById(`crossChart-${metric}`).getContext('2d');
      const chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: roomA.room_label,
              data: sA.history,
              borderColor: CROSS_COLOR_A,
              backgroundColor: CROSS_COLOR_A + '18',
              fill: false,
              borderWidth: 2.5,
              pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12,
              tension: 0.3
            },
            {
              label: roomB.room_label,
              data: sB.history,
              borderColor: CROSS_COLOR_B,
              backgroundColor: CROSS_COLOR_B + '18',
              fill: false,
              borderWidth: 2.5,
              pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12,
              tension: 0.3
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#16261F', titleColor: '#EAF3EC', bodyColor: '#EAF3EC',
              padding: 10, cornerRadius: 6,
              callbacks: {
                label: (c) => `${c.dataset.label}: ${c.formattedValue} ${sA.unit}`
              }
            },
            zoom: {
              pan: { enabled: true, mode: 'x' },
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: false }, mode: 'x' }
            }
          },
          scales: {
            x: { display: false },
            y: {
              grid: { color: cssVar('--border') },
              ticks: { font: { size: 10 }, color: cssVar('--text-muted') }
            }
          }
        }
      });
      crossCharts.push(chart);
      crossChartLabels.push(`${metric.replace('_', ' ')} (${sA.unit})`);
    });
  }

  /* ============================================================
     Shared helpers
  ============================================================ */
  function resetDefaults() {
    visibleDCs = new Set(['DC-Epsilon']);
    searchTerm = '';
    hiddenRoomKeys = new Set();
  }

  function renderAll() {
    renderModeTabs();
    renderRoomSelect();

    const acrossMode = mode === 'across';
    const withinMode = mode === 'within';
    const crossMode = mode === 'cross';

    // Show/hide card areas
    chartCard.style.display = acrossMode ? '' : 'none';
    roomGridEl.style.display = withinMode ? '' : 'none';
    crossGridEl.style.display = crossMode ? '' : 'none';
    hintEl.style.display = acrossMode ? '' : 'none';

    // Clear legend + controls + tabs when not in across mode
    if (!acrossMode) {
      compareTabs.innerHTML = '';
      controlsEl.innerHTML = '';
      legendEl.innerHTML = '';
      const rk = document.getElementById('compareRoomKey');
      if (rk) { rk.style.display = 'none'; rk.innerHTML = ''; }
      const rl = document.getElementById('compareRangeLine');
      if (rl) rl.textContent = '';
    }

    if (acrossMode) {
      renderAcrossTabs();
      renderControls();
      renderAcrossChart();
    } else if (withinMode) {
      renderWithinRoom();
    } else if (crossMode) {
      renderCrossRoom();
    }
  }

  /* ---- event listeners ---- */
  roomSelectEl.addEventListener('change', () => {
    currentRoomId = Number(roomSelectEl.value);
    if (mode === 'within') renderWithinRoom();
    else if (mode === 'cross') renderCrossRoom();
  });

  roomSelectElB.addEventListener('change', () => {
    currentRoomIdB = Number(roomSelectElB.value);
    if (mode === 'cross') renderCrossRoom();
  });

  /* ---- Export Handlers ---- */
  const exportCsvBtn = document.getElementById('compareExportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const rawSeries = DATA.compare.byMetric[currentMetric] || [];
      const series = computeVisibility(rawSeries).filter(s => s.visible && !hiddenRoomKeys.has(s.key));
      if (!series.length) return;

      const headers = ['Data Center', 'Room', 'Metric', 'Unit', ...series[0].history.map((_, i) => `Point_${i + 1}`)];
      const rows = series.map(s => [
        s.dc_name,
        `Room ${s.room_code}`,
        currentMetric,
        s.unit,
        ...s.history
      ]);

      window.PulseDC?.Utils?.exportToCsv(`PulseDC_Compare_${currentMetric}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
    });
  }

  const exportPngBtn = document.getElementById('compareExportPngBtn');
  if (exportPngBtn) {
    exportPngBtn.addEventListener('click', () => {
      const dateStamp = new Date().toISOString().slice(0, 10);

      if (mode === 'across') {
        if (!compareChart) return;
        window.PulseDC?.Utils?.exportChartAsPng(compareChart, `PulseDC_Compare_${currentMetric}_${dateStamp}`);
        return;
      }

      if (mode === 'within') {
        if (!roomCharts.length) return;
        const room = DATA.compare.byRoom[currentRoomId];
        const labels = room ? room.sensors.map(s => `${s.name.replace(' Sensor 1', '')} (${s.unit})`) : [];
        window.PulseDC?.Utils?.exportChartsAsPng(
          roomCharts,
          `PulseDC_Compare_Within_${room ? room.room_label.replace(/\s+/g, '_') : 'Room'}_${dateStamp}`,
          labels
        );
        return;
      }

      if (mode === 'cross') {
        if (!crossCharts.length) return;
        const roomA = rooms.find(r => r.id === currentRoomId);
        const roomB = rooms.find(r => r.id === currentRoomIdB);
        window.PulseDC?.Utils?.exportChartsAsPng(
          crossCharts,
          `PulseDC_Compare_Cross_${roomA ? roomA.room_code : 'A'}_vs_${roomB ? roomB.room_code : 'B'}_${dateStamp}`,
          crossChartLabels
        );
      }
    });
  }

  renderAll();

  return function refreshCompare(nextData) {
    const previousDCs = visibleDCs;
    const previousXScale = mode === 'across' && compareChart?.scales?.x
      ? { min: compareChart.scales.x.min, max: compareChart.scales.x.max, last: compareChart.data.labels.length - 1 }
      : null;
    DATA = nextData;
    metrics = Object.keys(DATA.compare.byMetric);
    rooms = DATA.compare.rooms;
    dcNames = [...new Set(rooms.map(r => r.dc_name))];
    currentMetric = metrics.includes(currentMetric) ? currentMetric : metrics[0];
    currentRoomId = rooms.some(room => room.id === currentRoomId) ? currentRoomId : rooms[0]?.id;
    currentRoomIdB = rooms.some(room => room.id === currentRoomIdB)
      ? currentRoomIdB
      : rooms.find(room => room.id !== currentRoomId)?.id ?? currentRoomId;
    visibleDCs = new Set([...previousDCs].filter(name => dcNames.includes(name)));
    hiddenRoomKeys = new Set([...hiddenRoomKeys].filter(key =>
      metrics.some(metric => (DATA.compare.byMetric[metric] || []).some(series => series.key === key))
    ));
    renderAll();
    if (previousXScale && mode === 'across' && compareChart?.zoomScale &&
        (previousXScale.min > 0 || previousXScale.max < previousXScale.last)) {
      compareChart.zoomScale('x', { min: previousXScale.min, max: previousXScale.max });
    }
  };
}
