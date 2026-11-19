/* DRILLDOWN — Client -> Data Center -> Room -> Sensor              */
function initDrilldown(DATA) {
  const clientSelect = document.getElementById('clientSelect');
  const dcSelect = document.getElementById('dcSelect');
  const roomSelect = document.getElementById('roomSelect');
  const dcStatusPill = document.getElementById('dcStatusPill');
  const dcTitle = document.getElementById('dcTitle');
  const dcLocation = document.getElementById('dcLocation');
  const roomMeta = document.getElementById('roomMeta');
  const tbody = document.getElementById('metricTableBody');
  let D = DATA.drilldown;
  const { escapeHtml } = window.PulseDC.Utils || { escapeHtml: s => String(s || '') };

  let ddChart = null;
  let expandedSensor = null;

  function populateClients() {
    clientSelect.innerHTML = D.clients.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('');
  }
  function populateDCs(clientId) {
    const dcs = D.data_centers.filter(d => d.client_id === Number(clientId));
    dcSelect.innerHTML = dcs.map(d => `<option value="${d.id}">${d.name} — ${d.location}</option>`).join('');
  }
  function populateRooms(dcId) {
    const dc = getDC(dcId);
    roomSelect.innerHTML = dc.rooms.map(r =>
      `<option value="${r.id}">Room ${r.room_code} — ${r.name} (${r.floor_level})</option>`
    ).join('');
  }
  function getDC(id) { return D.data_centers.find(d => d.id === Number(id)); }
  function getRoom(dc, roomId) { return dc.rooms.find(r => r.id === Number(roomId)); }
  function dcHasAlert(dc) { return dc.rooms.some(r => r.sensors.some(s => s.trend === 'down')); }

  function renderDC(dcId, roomId) {
    const dc = getDC(dcId);
    if (!dc) return;
    const room = getRoom(dc, roomId);
    if (!room) return;

    dcTitle.textContent = `${dc.name} — Room ${room.room_code}`;
    dcLocation.textContent = `${dc.location} · ${room.name}`;
    roomMeta.textContent = `${room.room_type[0].toUpperCase() + room.room_type.slice(1)} room · ${room.floor_level} · ${room.sensors.length} sensor${room.sensors.length !== 1 ? 's' : ''}`;
    expandedSensor = null;

    if (dcHasAlert(dc)) {
      dcStatusPill.textContent = 'Anomaly detected';
      dcStatusPill.className = 'status-pill alert';
    } else {
      dcStatusPill.textContent = 'Normal';
      dcStatusPill.className = 'status-pill ok';
    }

    const SENSOR_ROLES = {
      flow_rate: 'Coolant Flow (heat removal loop)',
      temperature: 'Ambient Room Temperature',
      humidity: 'Moisture Level (static/condensation prevention)',
      pressure: 'Pipe Closed-Loop Pressure'
    };

    const rows = room.sensors.map(s => {
      const isAlert = s.trend === 'down';
      const trendLabel = s.trend === 'down' ? '↓ Declining' : (s.trend === 'up' ? '↑ Rising' : '→ Stable');
      const trendClass = isAlert ? 'trend-down' : 'trend-stable';
      const badge = isAlert ? '<span class="badge alert">Needs Review</span>' : '<span class="badge normal">Healthy</span>';
      const friendlyRole = SENSOR_ROLES[s.metric_type] || s.metric_type.replace('_', ' ');
      return `
        <tr class="row-clickable" data-sensor="${s.id}">
          <td class="metric-name">
            <strong>${s.name}</strong>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${friendlyRole}</div>
            <div style="font-size:11px;color:var(--text-muted);font-weight:400">${s.sensor_code}</div>
          </td>
          <td class="val"><strong>${s.latest}</strong> <span style="color:var(--text-muted);font-weight:400;font-size:12px">${s.unit}</span></td>
          <td class="${trendClass}"><strong>${trendLabel}</strong></td>
          <td>${badge}</td>
          <td style="text-align:right"><span class="chevron">▸ view trend graph</span></td>
        </tr>
        <tr class="chart-row hidden" data-chart-for="${s.id}">
          <td colspan="5">
            <div class="chart-wrap">
              <canvas id="chart-${s.id}"></canvas>
              <div class="stat-strip">
                <span>Avg: <b>${s.avg} ${s.unit}</b></span>
                <span>Min: <b>${s.min} ${s.unit}</b></span>
                <span>Max: <b>${s.max} ${s.unit}</b></span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rows;
    tbody.querySelectorAll('tr.row-clickable').forEach(row => {
      row.addEventListener('click', () => toggleChart(row.dataset.sensor, room));
    });
  }

  function toggleChart(sensorId, room) {
    const allChartRows = tbody.querySelectorAll('.chart-row');
    const allDataRows = tbody.querySelectorAll('.row-clickable');
    const targetRow = tbody.querySelector(`.chart-row[data-chart-for="${sensorId}"]`);
    const targetDataRow = tbody.querySelector(`tr.row-clickable[data-sensor="${sensorId}"]`);
    const alreadyOpen = expandedSensor === sensorId;

    allChartRows.forEach(r => r.classList.add('hidden'));
    allDataRows.forEach(r => r.classList.remove('row-expanded'));
    if (ddChart) { ddChart.destroy(); ddChart = null; }

    if (alreadyOpen) { expandedSensor = null; return; }

    targetRow.classList.remove('hidden');
    targetDataRow.classList.add('row-expanded');
    expandedSensor = sensorId;

    const sensor = room.sensors.find(s => String(s.id) === String(sensorId));
    const canvas = document.getElementById(`chart-${sensorId}`);
    const ctx = canvas.getContext('2d');
    const isAlert = sensor.trend === 'down';

    // Create lush vertical area fill gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 160);
    if (isAlert) {
      gradient.addColorStop(0, 'rgba(217, 56, 56, 0.28)');
      gradient.addColorStop(1, 'rgba(217, 56, 56, 0.00)');
    } else {
      gradient.addColorStop(0, 'rgba(82, 183, 154, 0.32)');
      gradient.addColorStop(1, 'rgba(82, 183, 154, 0.00)');
    }

    ddChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sensor.sparkline.map((_, i) => i),
        datasets: [{
          data: sensor.sparkline,
          borderColor: isAlert ? '#D93838' : '#2A9D8F',
          backgroundColor: gradient,
          fill: true,
          tension: 0.38,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: isAlert ? '#D93838' : '#2A9D8F',
          borderWidth: 2.4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 33, 28, 0.94)',
            titleFont: { size: 11, family: 'Inter' },
            bodyFont: { size: 12, weight: '600', family: 'Inter' },
            padding: 9,
            displayColors: false,
            callbacks: {
              label: (context) => `Reading: ${context.parsed.y} ${sensor.unit}`
            }
          }
        },
        scales: {
          x: { display: false },
          y: {
            grid: { color: cssVar('--border') },
            ticks: {
              font: { size: 11 },
              color: cssVar('--text-muted'),
              callback: (val) => `${val} ${sensor.unit}`
            }
          }
        }
      }
    });
  }

  clientSelect.addEventListener('change', () => {
    populateDCs(clientSelect.value);
    populateRooms(dcSelect.value);
    renderDC(dcSelect.value, roomSelect.value);
  });
  dcSelect.addEventListener('change', () => {
    populateRooms(dcSelect.value);
    renderDC(dcSelect.value, roomSelect.value);
  });
  roomSelect.addEventListener('change', () => renderDC(dcSelect.value, roomSelect.value));

  populateClients();
  const initClient = D.clients[0].id;
  clientSelect.value = initClient;
  populateDCs(initClient);
  const initDC = D.data_centers.find(d => d.client_id === Number(initClient)).id;
  dcSelect.value = initDC;
  populateRooms(initDC);
  const initRoom = getDC(initDC).rooms[0].id;
  roomSelect.value = initRoom;
  renderDC(initDC, initRoom);

  // expose for cross-page linking (forecast / alerts / investigations -> drilldown)
  window.gotoDrilldown = function (clientId, dcId, roomId, sensorId, returnBreadcrumb) {
    const drilldownNav = document.querySelector('.nav-item[data-page="drilldown"]');
    if (drilldownNav) drilldownNav.click();
    if (clientId) {
      clientSelect.value = clientId;
      populateDCs(clientId);
    }
    if (dcId) {
      dcSelect.value = dcId;
      populateRooms(dcId);
    }
    if (roomId) roomSelect.value = roomId;
    renderDC(dcSelect.value, roomSelect.value);

    // If returning from another view, show a return breadcrumb
    const headerEl = document.querySelector('#page-drilldown .card-header');
    const existingBanner = document.getElementById('drilldownReturnBanner');
    if (existingBanner) existingBanner.remove();

    if (returnBreadcrumb) {
      const banner = document.createElement('div');
      banner.id = 'drilldownReturnBanner';
      banner.className = 'drilldown-return-banner';
      banner.innerHTML = `
        <button type="button" class="btn-return" id="drilldownReturnBtn">
          <i class="fi fi-rr-arrow-left"></i> Back to ${escapeHtml(returnBreadcrumb.label || 'previous page')}
        </button>
        <span>Inspecting facility for alert ${escapeHtml(returnBreadcrumb.alertTitle || '')}</span>
      `;
      headerEl?.insertAdjacentElement('beforebegin', banner);
      document.getElementById('drilldownReturnBtn')?.addEventListener('click', () => {
        banner.remove();
        if (returnBreadcrumb.page) {
          const navItem = document.querySelector(`.nav-item[data-page="${returnBreadcrumb.page}"]`);
          if (navItem) navItem.click();
        }
      });
    }

    if (sensorId) {
      setTimeout(() => {
        const row = tbody.querySelector(`tr.row-clickable[data-sensor="${sensorId}"]`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const room = getRoom(getDC(dcSelect.value), roomSelect.value);
          if (room) toggleChart(sensorId, room);
        }
      }, 100);
    }
  };

  return function refreshDrilldown(nextData) {
    const selectedClient = Number(clientSelect.value);
    const selectedDC = Number(dcSelect.value);
    const selectedRoom = Number(roomSelect.value);
    const selectedSensor = expandedSensor;
    D = nextData.drilldown;
    populateClients();
    clientSelect.value = D.clients.some(c => c.id === selectedClient) ? selectedClient : D.clients[0]?.id;
    populateDCs(clientSelect.value);
    dcSelect.value = dcSelect.options.length && [...dcSelect.options].some(o => Number(o.value) === selectedDC)
      ? selectedDC
      : dcSelect.options[0]?.value;
    populateRooms(dcSelect.value);
    roomSelect.value = [...roomSelect.options].some(o => Number(o.value) === selectedRoom)
      ? selectedRoom
      : roomSelect.options[0]?.value;
    if (ddChart) { ddChart.destroy(); ddChart = null; }
    renderDC(dcSelect.value, roomSelect.value);
    const currentRoom = getRoom(getDC(dcSelect.value), roomSelect.value);
    if (selectedSensor && currentRoom?.sensors.some(sensor => String(sensor.id) === String(selectedSensor))) {
      toggleChart(selectedSensor, currentRoom);
    }
  };
}
