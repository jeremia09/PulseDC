/* FORECAST — ranks data centers, tabs let you drill into each sensor within the site */
function initForecast(DATA) {
  let F = DATA.forecast;
  let H = DATA.forecast_hist;
  const rankList = document.getElementById('rankList');
  const fcTitle = document.getElementById('fcTitle');
  const fcMeta = document.getElementById('fcMeta');
  const fcMetricTabs = document.getElementById('fcMetricTabs');
  const fcStatGrid = document.getElementById('fcStatGrid');
  const fcProvenance = document.getElementById('fcProvenance');
  const fcCallout = document.getElementById('fcCallout');
  let currentDC = F[0];
  let currentSensorId = F[0].worst_sensor_id;
  let fcChart = null;

  function riskLabel(r) { return r === 'high' ? 'High risk' : (r === 'watch' ? 'Watch' : 'Stable'); }
  function currentSensor() { return currentDC.sensors.find(s => s.sensor_id === currentSensorId); }

  function renderRankList() {
    rankList.innerHTML = F.map(dc => `
      <div class="rank-row ${dc.id === currentDC.id ? 'active' : ''}" data-id="${dc.id}">
        <div>
          <div class="rank-name">${dc.name}</div>
          <div class="rank-meta">${dc.client} · ${dc.location}</div>
        </div>
        <span class="badge ${dc.overall_risk}">${riskLabel(dc.overall_risk)}</span>
      </div>
    `).join('');
    rankList.querySelectorAll('.rank-row').forEach(row => {
      row.addEventListener('click', () => {
        currentDC = F.find(d => d.id === Number(row.dataset.id));
        currentSensorId = currentDC.worst_sensor_id;
        renderAll();
      });
    });
  }

  function renderTabs() {
    fcMetricTabs.innerHTML = currentDC.sensors.map(s => {
      const isRisk = s.risk === 'high';
      const isWatch = s.risk === 'watch';
      const riskClass = isRisk ? 'risk-high' : (isWatch ? 'risk-watch' : '');
      const activeClass = s.sensor_id === currentSensorId ? 'active' : '';
      const metricName = s.metric_type.replace('_', ' ');

      return `
        <button class="fc-metric-pill ${activeClass} ${riskClass}" data-sensor="${s.sensor_id}" title="${s.room_name} - ${metricName}">
          <span class="fc-pill-left">
            <span class="fc-pill-room">${s.room_name}</span>
            <span class="fc-pill-sep">&middot;</span>
            <span class="fc-pill-metric">${metricName}</span>
          </span>
          ${isRisk ? '<span class="fc-pill-badge high">Risk</span>' : (isWatch ? '<span class="fc-pill-badge watch">Watch</span>' : '')}
        </button>
      `;
    }).join('');

    fcMetricTabs.querySelectorAll('.fc-metric-pill').forEach(btn => {
      btn.addEventListener('click', () => { 
        currentSensorId = Number(btn.dataset.sensor); 
        renderAll(); 
      });
    });
  }

  function renderDetail() {
    const s = currentSensor();
    if (!s) return;
    fcTitle.textContent = currentDC.name;
    fcMeta.textContent = `${currentDC.client} · ${currentDC.location} · ${s.room_name} · ${s.sensor_code}`;

    fcStatGrid.innerHTML = `
      <div class="stat-box2"><p class="label">Current</p><p class="value">${s.current} ${s.unit}</p></div>
      <div class="stat-box2 ${s.risk !== 'stable' ? 'risk' : ''}"><p class="label">Projected (7d)</p><p class="value">${s.projected_7d} ${s.unit}</p></div>
      <div class="stat-box2"><p class="label">Trend</p><p class="value">${s.trend_dir === 'down' ? '↓ down' : (s.trend_dir === 'up' ? '↑ up' : '→ flat')}</p></div>
      <div class="stat-box2 ${s.risk !== 'stable' ? 'risk' : ''}"><p class="label">Risk</p><p class="value">${riskLabel(s.risk)}</p></div>
    `;

    const showDate = timestamp => {
      if (!timestamp) return 'unavailable';
      const date = new Date(timestamp.replace(' ', 'T'));
      return Number.isNaN(date.getTime())
        ? 'unavailable'
        : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    };
    const historyRange = `${showDate(s.history_start)}–${showDate(s.history_end)}`;
    const backtestText = s.backtest?.count
      ? `24h backtest MAE ${s.backtest.mae} ${s.unit} (${s.backtest.count} samples); 7-day accuracy not validated.`
      : 'Not enough history for a 24h backtest.';
    fcProvenance.textContent = `${s.history_count} readings · ${historyRange} · ${backtestText}`;

    const metricLabel = s.metric_type.replace('_', ' ');
    if (s.already_crossed) {
      fcCallout.className = 'callout high';
      fcCallout.innerHTML = `<strong><i class="fi fi-rr-triangle-warning" aria-hidden="true"></i> Immediate Risk:</strong> ${s.name} (${metricLabel}) is currently outside safe operating limits (${s.current} ${s.unit}). Dispatch maintenance or adjust system settings immediately to avoid server downtime.`;
    } else if (s.risk === 'high') {
      const daysStr = s.days_to_threshold != null ? `within approximately ${s.days_to_threshold} days` : 'soon';
      fcCallout.className = 'callout high';
      fcCallout.innerHTML = `<strong><i class="fi fi-rr-triangle-warning" aria-hidden="true"></i> Projected Issue:</strong> At current rates, this room will cross into dangerous levels <strong>${daysStr}</strong>. Schedule preventative inspection before this becomes an urgent incident.`;
    } else if (s.risk === 'watch') {
      const daysStr = s.days_to_threshold != null ? `(~${s.days_to_threshold} days away)` : '';
      fcCallout.className = 'callout watch';
      fcCallout.innerHTML = `<strong><i class="fi fi-rr-eye" aria-hidden="true"></i> Keep An Eye:</strong> Telemetry is drifting toward threshold limits ${daysStr}. No urgent action is needed right now, but check again tomorrow.`;
    } else {
      fcCallout.className = 'callout stable';
      fcCallout.innerHTML = `<strong><i class="fi fi-rr-check-circle" aria-hidden="true"></i> All Clear:</strong> This system is completely stable and projected to stay safely within operational parameters for the week ahead.`;
    }

    if (fcChart) fcChart.destroy();
    const ctx = document.getElementById('forecastChart').getContext('2d');
    const isRisk = s.risk !== 'stable';
    const hist = H[s.sensor_id] || { actual: [], projected: [] };
    const actual = hist.actual || [];
    const timestamps = hist.timestamps || [];
    const projected = hist.projected || [];
    const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const historyStride = Math.max(1, Math.ceil(Math.max(0, actual.length - 1) / 3));
    const historyLabels = actual.map((_, index) => {
      if (index !== 0 && index !== actual.length - 1 && index % historyStride !== 0) return '';
      const timestamp = timestamps[index];
      if (!timestamp) return '';
      const date = new Date(timestamp.replace(' ', 'T'));
      return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
    });
    const labels = historyLabels.concat(['+2d', '+4d', '+7d']);
    const actualData = actual.concat([null, null, null]);
    const projectedData = new Array(Math.max(0, actual.length - 1)).fill(null).concat([actual[actual.length - 1] || null, projected[1] || null, projected[2] || null, projected[3] || null]);
    const historyEndLabel = actual.length ? actual.length - 1 : null;

    fcChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Historical', data: actualData, borderColor: '#2F6FED', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Projected', data: projectedData, borderColor: isRisk ? '#C43D3D' : '#2F6FED', backgroundColor: isRisk ? 'rgba(196,61,61,0.08)' : 'rgba(47,111,237,0.06)', borderDash: [6, 4], fill: isRisk, tension: 0.2, pointRadius: (c) => c.dataIndex === labels.length - 1 ? 4 : 0, pointBackgroundColor: isRisk ? '#C43D3D' : '#2F6FED', borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              pointStyle: 'line',
              boxWidth: 18,
              color: cssVar('--text-muted'),
              font: { size: 11 }
            }
          },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.formattedValue} ${s.unit}` } },
          annotation: historyEndLabel === null ? {} : {
            annotations: {
              historyBoundary: {
                type: 'line',
                xMin: historyEndLabel,
                xMax: historyEndLabel,
                borderColor: cssVar('--text-muted'),
                borderWidth: 1,
                borderDash: [3, 4],
                label: {
                  display: true,
                  content: 'Projection starts',
                  position: 'start',
                  color: cssVar('--text-muted'),
                  backgroundColor: 'transparent',
                  font: { size: 10 },
                  yAdjust: -4
                }
              }
            }
          }
        },
        scales: {
          y: { grid: { color: cssVar('--border') }, ticks: { font: { size: 11 }, color: cssVar('--text-muted') } },
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#5B5F6B', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }
        }
      }
    });
  }

  function renderAll() { renderRankList(); renderTabs(); renderDetail(); }

  /* ---- Export Handlers for Forecast ---- */
  const fcExportCsvBtn = document.getElementById('forecastExportCsvBtn');
  if (fcExportCsvBtn) {
    fcExportCsvBtn.addEventListener('click', () => {
      const allSensors = [];
      F.forEach(dc => {
        (dc.sensors || []).forEach(s => {
          allSensors.push([
            dc.name,
            dc.client,
            dc.location,
            s.room_name,
            s.sensor_code,
            s.metric_type,
            s.current,
            s.projected_7d,
            s.unit,
            s.trend_dir,
            s.risk,
            s.days_to_threshold != null ? s.days_to_threshold : 'N/A',
            s.history_count,
            s.history_start || 'N/A',
            s.history_end || 'N/A',
            s.backtest?.mae != null ? s.backtest.mae : 'N/A',
            s.backtest?.count || 0
          ]);
        });
      });

      if (!allSensors.length) return;

      const headers = ['Data Center', 'Client', 'Location', 'Room', 'Sensor Code', 'Metric', 'Current Value', 'Projected (7d)', 'Unit', 'Trend', 'Risk Level', 'Days to Threshold', 'Training Readings', 'Training Start', 'Training End', '24h Backtest MAE', '24h Backtest Samples'];
      window.PulseDC?.Utils?.exportToCsv(`PulseDC_Forecast_Projections_${new Date().toISOString().slice(0, 10)}`, headers, allSensors);
    });
  }

  const fcExportPngBtn = document.getElementById('forecastExportPngBtn');
  if (fcExportPngBtn) {
    fcExportPngBtn.addEventListener('click', () => {
      if (!fcChart) return;
      const s = currentSensor();
      const filename = `PulseDC_Forecast_${currentDC.name}_${s ? s.sensor_code : 'Sensor'}_Chart`;
      window.PulseDC?.Utils?.exportChartAsPng(fcChart, filename);
    });
  }

  renderAll();

  return function refreshForecast(nextData) {
    const selectedDCId = currentDC.id;
    const selectedSensorId = currentSensorId;
    F = nextData.forecast;
    H = nextData.forecast_hist;
    currentDC = F.find(dc => dc.id === selectedDCId) || F[0];
    currentSensorId = currentDC?.sensors.some(sensor => sensor.sensor_id === selectedSensorId)
      ? selectedSensorId
      : currentDC?.worst_sensor_id;
    renderAll();
  };
}
