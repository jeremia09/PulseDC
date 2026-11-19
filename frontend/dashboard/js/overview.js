/* ============================================================
   overview.js — Dashboard Overview View Controller
   Consumes SimulationEngine, ThresholdEngine, and federated DATA.
   ============================================================ */

function initOverview(DATA) {
  const { escapeHtml } = window.PulseDC?.Utils || { escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) };
  const ov = DATA.overview;
  document.getElementById('ovTotalSites').textContent = ov.total_sites;
  document.getElementById('ovTotalClients').textContent = ov.total_clients;

  const activeAlertDCs = new Set(DATA.alerts.filter(a => a.severity !== 'resolved').map(a => a.data_center_id));
  const activeAlertCount = DATA.alerts.filter(a => a.severity !== 'resolved').length;
  document.getElementById('ovActiveAlerts').textContent = activeAlertCount;
  document.getElementById('ovHealthySites').textContent = ov.total_sites - activeAlertDCs.size;

  /* ---------------- Fleet Health Executive Banner Logic ---------------- */
  const bannerEl = document.getElementById('fleetHealthBanner');
  const orbEl = document.getElementById('fleetStatusOrb');
  const headlineEl = document.getElementById('fleetStatusHeadline');
  const detailEl = document.getElementById('fleetStatusDetail');
  const viewAlertsBtn = document.getElementById('fleetViewAlertsBtn');
  const copySummaryBtn = document.getElementById('fleetCopySummaryBtn');

  function updateFleetBanner(alertCount, healthyCount, totalCount, affectedFacilityCount = activeAlertDCs.size) {
    if (!bannerEl) return;
    if (alertCount === 0) {
      bannerEl.className = 'fleet-health-banner status-optimal';
      if (orbEl) orbEl.innerHTML = '<span class="fleet-status-icon"><i class="fi fi-rr-shield-check"></i></span>';
      if (headlineEl) headlineEl.textContent = 'All Data Centers Operating Normally';
      if (detailEl) detailEl.textContent = `All ${totalCount} monitored facilities are well within safe cooling, airflow, and temperature limits.`;
      if (viewAlertsBtn) viewAlertsBtn.style.display = 'none';
      if (copySummaryBtn) copySummaryBtn.className = 'fleet-action-btn primary';
    } else {
      bannerEl.className = 'fleet-health-banner status-action';
      if (orbEl) orbEl.innerHTML = '<span class="fleet-status-icon"><i class="fi fi-rr-triangle-warning"></i></span>';
      if (headlineEl) headlineEl.textContent = `${affectedFacilityCount} ${affectedFacilityCount === 1 ? 'facility' : 'facilities'} needing attention (${alertCount} active ${alertCount === 1 ? 'alert' : 'alerts'})`;
      if (detailEl) detailEl.textContent = 'Review the alert first, then use Assisted Fixes for guided checks.';
      if (viewAlertsBtn) {
        viewAlertsBtn.style.display = 'inline-flex';
        viewAlertsBtn.className = 'fleet-action-btn primary';
        viewAlertsBtn.onclick = () => {
          const alertsNav = document.querySelector('.nav-item[data-page="alerts"]');
          if (alertsNav) alertsNav.click();
        };
      }
      if (copySummaryBtn) copySummaryBtn.className = 'fleet-action-btn secondary';
    }
  }

  updateFleetBanner(activeAlertCount, ov.total_sites - activeAlertDCs.size, ov.total_sites);

  if (copySummaryBtn) {
    copySummaryBtn.onclick = () => {
      const currentAlerts = DATA.alerts.filter(alert => alert.severity !== 'resolved');
      const currentAlertDCs = new Set(currentAlerts.map(alert => alert.data_center_id));
      const currentSiteCount = DATA.overview.total_sites;
      const summaryText = `[PulseDC Health Report - ${new Date().toLocaleDateString()}]\n` +
        `• Status: ${currentAlerts.length === 0 ? 'Optimal (All sites normal)' : `${currentAlerts.length} active alerts in ${currentAlertDCs.size} facilities`}\n` +
        `• Healthy Facilities: ${currentSiteCount - currentAlertDCs.size} / ${currentSiteCount}\n` +
        `• Monitored Clients: ${DATA.overview.total_clients}\n` +
        `• Next Action: ${currentAlerts.length === 0 ? 'No action needed.' : 'Review Alerts, then use Assisted Fixes for guided checks.'}`;
      navigator.clipboard?.writeText(summaryText).then(() => {
        const orig = copySummaryBtn.innerHTML;
        copySummaryBtn.innerHTML = '<i class="fi fi-rr-check"></i> Copied to Clipboard!';
        setTimeout(() => copySummaryBtn.innerHTML = orig, 2500);
      }).catch(() => {
        alert(summaryText);
      });
    };
  }

  // Active alerts card only reads as urgent (red) when something is actually wrong
  const alertsBox = document.getElementById('ovActiveAlertsBox');
  if (alertsBox) {
    alertsBox.classList.toggle('danger', activeAlertCount > 0);
    alertsBox.addEventListener('click', () => {
      const alertsNavItem = document.querySelector('.nav-item[data-page="alerts"]');
      if (alertsNavItem) alertsNavItem.click();
    });
  }

  const healthyBox = document.getElementById('ovHealthyBox');
  if (healthyBox) {
    healthyBox.addEventListener('click', () => {
      applySiteFilter('ok');
    });
  }

  const totalSitesBox = document.getElementById('ovTotalSitesBox');
  if (totalSitesBox) {
    totalSitesBox.addEventListener('click', () => {
      applySiteFilter('all');
    });
  }

  const siteGrid = document.getElementById('siteGrid');
  const SITE_IMAGES = {
    'DC-Alpha': 'img/dc-alpha.jpg',
    'DC-Beta': 'img/dc-beta.jpg',
    'DC-Gamma': 'img/dc-gamma.jpg',
    'DC-Delta': 'img/dc-delta.jpg',
    'DC-Epsilon': 'img/dc-epsilon.jpg',
    'DC-Zeta': 'img/dc-zeta.jpg',
  };

  const METRIC_PLAIN_EXPLANATIONS = {
    flow_rate: 'Coolant Flow — how quickly cooling liquid moves through server racks',
    temperature: 'Room Temperature — safe recommended range is 18 to 27°C',
    humidity: 'Air Moisture — safe recommended range is 35 to 55%',
    pressure: 'Cooling Pressure — safe pipe pressure is 90 to 110 kPa'
  };

  const METRIC_BOUNDS = {
    flow_rate: { min: 20, max: 45, safeMin: 30, safeMax: 45 },
    temperature: { min: 14, max: 32, safeMin: 18, safeMax: 27 },
    humidity: { min: 25, max: 70, safeMin: 35, safeMax: 55 },
    pressure: { min: 75, max: 125, safeMin: 90, safeMax: 110 }
  };

  const METRIC_CONFIG = {
    flow_rate: {
      label: 'Coolant Flow',
      icon: 'fi-rr-water',
      min: 20, max: 45, safeMin: 30, safeMax: 45,
      desc: 'Normal: 30–45 L/min'
    },
    temperature: {
      label: 'Room Temperature',
      icon: 'fi-rr-temperature-high',
      min: 14, max: 32, safeMin: 18, safeMax: 27,
      desc: 'Normal: 18–27 °C'
    },
    humidity: {
      label: 'Air Moisture',
      icon: 'fi-rr-humidity',
      min: 25, max: 70, safeMin: 35, safeMax: 55,
      desc: 'Normal: 35–55 %RH'
    },
    pressure: {
      label: 'Cooling Pressure',
      icon: 'fi-rr-chart-line-up',
      min: 75, max: 125, safeMin: 90, safeMax: 110,
      desc: 'Normal: 90–110 kPa'
    }
  };

  function getRangePercent(metric, val) {
    const b = METRIC_CONFIG[metric] || METRIC_BOUNDS[metric] || { min: 0, max: 100 };
    const clamped = Math.max(b.min, Math.min(b.max, val));
    return Math.round(((clamped - b.min) / (b.max - b.min)) * 100);
  }

  function getSafeZonePercent(metric) {
    const cfg = METRIC_CONFIG[metric] || METRIC_BOUNDS[metric] || { min: 0, max: 100, safeMin: 20, safeMax: 80 };
    const range = (cfg.max - cfg.min) || 100;
    const leftPct = Math.max(0, Math.min(100, Math.round(((cfg.safeMin - cfg.min) / range) * 100)));
    const rightPct = Math.max(0, Math.min(100, Math.round(((cfg.safeMax - cfg.min) / range) * 100)));
    return { leftPct, widthPct: Math.max(6, rightPct - leftPct) };
  }

  function getMetricHealth(metric, val) {
    const b = METRIC_CONFIG[metric] || METRIC_BOUNDS[metric];
    if (!b) return 'normal';
    if (val < b.safeMin || (b.safeMax && val > b.safeMax)) return 'alert';
    return 'normal';
  }

  const orderedSites = Object.entries(ov.snapshot).sort(([aId, a], [bId, b]) => {
    const alertOrder = Number(activeAlertDCs.has(Number(bId))) - Number(activeAlertDCs.has(Number(aId)));
    return alertOrder || a.name.localeCompare(b.name);
  });

  siteGrid.innerHTML = orderedSites.map(([id, dc]) => {
    const isAlert = activeAlertDCs.has(Number(id));
    const rows = Object.entries(dc.metrics).map(([m, v]) => {
      const metricHealth = getMetricHealth(m, v);
      const isBreached = metricHealth === 'alert';
      const cfg = METRIC_CONFIG[m] || { label: m.replace('_', ' '), icon: 'fi-rr-chart-line-up', desc: 'Monitored reading' };
      const tooltip = METRIC_PLAIN_EXPLANATIONS[m] || m;
      const pct = getRangePercent(m, v);
      const { leftPct, widthPct } = getSafeZonePercent(m);
      const unit = UNITS[m] || '';

      return `
        <div class="mini-metric ${isBreached ? 'flag' : ''}" data-metric="${escapeHtml(m)}" title="${escapeHtml(tooltip)}">
          <div class="metric-top-row">
            <div class="m-ident">
              <span class="m-icon-chip ${escapeHtml(m)}">
                <i class="fi ${escapeHtml(cfg.icon)}" aria-hidden="true"></i>
              </span>
              <div class="m-info">
                <span class="m-lbl">${escapeHtml(cfg.label)}</span>
                <span class="m-sub">${escapeHtml(cfg.desc)}</span>
              </div>
            </div>
            <div class="m-reading-group">
              <span class="m-val"><b>${v}</b><span class="m-unit"> ${escapeHtml(unit)}</span></span>
              <span class="m-status-pill ${isBreached ? 'status-breach' : 'status-ok'}">
                <i class="fi ${isBreached ? 'fi-rr-triangle-warning' : 'fi-rr-check'}" aria-hidden="true"></i>
                ${isBreached ? 'Out of range' : 'Normal'}
              </span>
            </div>
          </div>
          <div class="metric-mini-bar" aria-hidden="true">
            <div class="metric-mini-target-zone" style="left:${leftPct}%; width:${widthPct}%;"></div>
            <div class="metric-mini-fill ${isBreached ? 'fill-alert' : 'fill-ok'}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
    const metricCount = Object.keys(dc.metrics).length;

    const imgSrc = SITE_IMAGES[dc.name];
    const thumb = imgSrc
      ? `<img class="site-thumb" src="${imgSrc}" alt="${escapeHtml(dc.name)}" onerror="this.parentElement.classList.add('no-thumb'); this.remove();">`
      : '';

    return `
      <div class="site-card ${isAlert ? 'alert' : ''}" data-dc-name="${escapeHtml(dc.name)}" data-dc-id="${escapeHtml(id)}" data-has-alert="${isAlert}">
        ${thumb}
        <div class="site-card-heading">
          <p class="name">${escapeHtml(dc.name)}</p>
          <span class="site-alert-badge" ${isAlert ? '' : 'hidden'}>Needs Attention</span>
        </div>
        <p class="loc">${escapeHtml(dc.client)} · ${escapeHtml(dc.location)}</p>
        <div class="site-status-tag ${isAlert ? 'tag-warn' : 'tag-ok'}">
          ${isAlert ? '<i class="fi fi-rr-triangle-warning" aria-hidden="true"></i> Variance detected' : '<i class="fi fi-rr-check-circle" aria-hidden="true"></i> All systems normal'}
        </div>
        <div class="site-readings-wrapper">
          <button type="button" class="site-readings-trigger" aria-expanded="false" aria-haspopup="dialog" aria-controls="readings-popover-${escapeHtml(id)}" title="Click to view live conditions for ${escapeHtml(dc.name)}">
            <span class="trigger-label">
              <i class="fi fi-rr-settings-sliders trigger-icon" aria-hidden="true"></i>
              <span>View live readings</span>
            </span>
            <span class="trigger-badge-wrap">
              <span class="trigger-count">${metricCount}</span>
              <i class="fi fi-rr-angle-small-down trigger-chevron" aria-hidden="true"></i>
            </span>
          </button>
          <div class="site-readings-popover" id="readings-popover-${escapeHtml(id)}" role="dialog" aria-label="${escapeHtml(dc.name)} Live Readings" hidden>
            <div class="popover-arrow" aria-hidden="true"></div>
            <div class="popover-header">
              <div class="popover-titles">
                <span class="popover-live-tag">
                  <span class="live-pulse-dot" aria-hidden="true"></span>
                  <span>Live Conditions</span>
                </span>
                <h4 class="popover-title">${escapeHtml(dc.name)} Conditions</h4>
              </div>
              <button type="button" class="popover-close-btn" aria-label="Close readings panel" title="Close (Escape)">
                <i class="fi fi-rr-cross-small" aria-hidden="true"></i>
              </button>
            </div>
            <div class="site-metrics-grid">${rows}</div>
            <div class="popover-footer">
              <span class="footer-meta">
                <i class="fi fi-rr-clock" aria-hidden="true"></i> Updates every 15 minutes
              </span>
              ${isAlert ? `
                <button type="button" class="popover-action-btn alert-link" data-goto-alerts="${escapeHtml(id)}">
                  <span>Review this alert</span>
                  <i class="fi fi-rr-arrow-small-right" aria-hidden="true"></i>
                </button>
              ` : `
                <span class="footer-status-ok">
                  <i class="fi fi-rr-shield-check" aria-hidden="true"></i> All readings are normal
                </span>
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const readingsBackdrop = siteGrid.parentElement.querySelector('.site-readings-backdrop');
  let openCard = null;

  function closeOpenReadings() {
    if (!openCard) return;
    const trigger = openCard.querySelector('.site-readings-trigger');
    const popover = openCard.querySelector('.site-readings-popover');
    openCard.classList.remove('readings-open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (popover) {
      popover.classList.remove('is-visible');
      popover.hidden = true;
    }
    openCard = null;
    if (readingsBackdrop) readingsBackdrop.classList.remove('visible');
  }

  function openReadings(card) {
    if (openCard && openCard !== card) {
      closeOpenReadings();
    }
    const trigger = card.querySelector('.site-readings-trigger');
    const popover = card.querySelector('.site-readings-popover');
    if (!trigger || !popover) return;

    card.classList.add('readings-open');
    trigger.setAttribute('aria-expanded', 'true');
    popover.hidden = false;

    // Check right-edge bounds
    const triggerRect = trigger.getBoundingClientRect();
    const wouldOverflowRight = (triggerRect.left + 350) > window.innerWidth;
    popover.classList.toggle('align-right', wouldOverflowRight);

    requestAnimationFrame(() => {
      popover.classList.add('is-visible');
    });

    openCard = card;
    if (readingsBackdrop) readingsBackdrop.classList.add('visible');
  }

  siteGrid.querySelectorAll('.site-card').forEach(card => {
    const trigger = card.querySelector('.site-readings-trigger');
    const popover = card.querySelector('.site-readings-popover');
    const closeBtn = card.querySelector('.popover-close-btn');

    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openCard === card) {
        closeOpenReadings();
      } else {
        openReadings(card);
      }
    });

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOpenReadings();
      trigger?.focus();
    });

    popover?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const alertLink = popover?.querySelector('[data-goto-alerts]');
    alertLink?.addEventListener('click', (e) => {
      e.preventDefault();
      closeOpenReadings();
      const alertsNav = document.querySelector('.nav-item[data-page="alerts"]');
      if (alertsNav) alertsNav.click();
    });
  });

  readingsBackdrop?.addEventListener('click', () => {
    closeOpenReadings();
  });

  document.addEventListener('click', (event) => {
    if (openCard && !openCard.contains(event.target)) {
      closeOpenReadings();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openCard) {
      const trigger = openCard.querySelector('.site-readings-trigger');
      closeOpenReadings();
      trigger?.focus();
    }
  });

  /* ---------------- Site Directory Filtering (All / Needs Attention / Healthy) ---------------- */
  let currentSiteFilter = 'all';
  function applySiteFilter(filter) {
    closeOpenReadings();
    currentSiteFilter = filter;
    document.querySelectorAll('#siteFilterPills .filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.siteFilter === filter);
    });
    siteGrid.querySelectorAll('.site-card').forEach(card => {
      const hasAlert = card.dataset.hasAlert === 'true';
      if (filter === 'all') {
        card.style.display = '';
      } else if (filter === 'alert') {
        card.style.display = hasAlert ? '' : 'none';
      } else if (filter === 'ok') {
        card.style.display = !hasAlert ? '' : 'none';
      }
    });
  }

  document.querySelectorAll('#siteFilterPills .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => applySiteFilter(chip.dataset.siteFilter));
  });

  /* ---------------- Live Telemetry Feed (Powered by SimulationEngine) ---------------- */
  const liveFeed = document.getElementById('liveFeed');
  const pulseDot = document.getElementById('pulseDot');
  const liveToggleBtn = document.getElementById('liveToggleBtn');

  const METRIC_ICONS = {
    flow_rate: 'fi-rr-water',
    temperature: 'fi-rr-temperature-high',
    humidity: 'fi-rr-humidity',
    pressure: 'fi-rr-chart-line-up'
  };

  function renderFeedRow(item) {
    const severity = item.severity || (item.is_alert ? 'critical' : 'ok');
    const rowClass = severity === 'critical' ? 'live-row-alert' : (severity === 'warning' ? 'live-row-warning' : '');
    const valClass = severity === 'critical' ? 'lval-alert' : (severity === 'warning' ? 'lval-warning' : '');
    const iconClass = METRIC_ICONS[item.metric_type] || 'fi-rr-chart-line-up';
    return `
      <div class="live-row ${rowClass}">
        <div>
          <div class="lname"><span class="lmeta-icon"><i class="fi ${iconClass}" aria-hidden="true"></i></span>${item.is_alert ? '<i class="fi fi-rr-triangle-warning live-alert-icon" aria-label="Alert"></i>' : ''}${item.dc_name}</div>
          <div class="lmeta">${item.metric_type.replace('_', ' ')} · ${item.room_name || ''} · ${item.location}<span class="ltime">· just now</span></div>
        </div>
        <div class="lval ${valClass}">${item.value} ${UNITS[item.metric_type]}</div>
        <span class="live-pulse-ring pulse-${severity}"></span>
      </div>
    `;
  }

  function updateSiteCard(item) {
    const card = siteGrid.querySelector(`.site-card[data-dc-name="${item.dc_name}"]`);
    if (!card) return;
    const metricEl = card.querySelector(`.mini-metric[data-metric="${item.metric_type}"] b`);
    if (metricEl) {
      metricEl.textContent = `${item.value}`;
      const metricRow = metricEl.closest('.mini-metric');
      if (metricRow) {
        metricRow.classList.toggle('flag', item.is_alert);
        const statusPill = metricRow.querySelector('.m-status-pill');
        if (statusPill) {
          statusPill.className = `m-status-pill ${item.is_alert ? 'status-breach' : 'status-ok'}`;
          statusPill.innerHTML = `<i class="fi ${item.is_alert ? 'fi-rr-triangle-warning' : 'fi-rr-check'}" aria-hidden="true"></i> ${item.is_alert ? 'Out of range' : 'Normal'}`;
        }
        const fill = metricRow.querySelector('.metric-mini-fill');
        if (fill) {
          fill.className = `metric-mini-fill ${item.is_alert ? 'fill-alert' : 'fill-ok'}`;
          fill.style.width = `${getRangePercent(item.metric_type, item.value)}%`;
        }
      }
      card.classList.add('pulse-update');
      setTimeout(() => card.classList.remove('pulse-update'), 700);
    }
    const anyFlag = card.querySelector('.mini-metric.flag') !== null;
    card.classList.toggle('alert', anyFlag);
  }

  function handleLiveTick(item) {
    const row = document.createElement('div');
    row.innerHTML = renderFeedRow(item);
    const rowEl = row.firstElementChild;
    liveFeed.prepend(rowEl);
    while (liveFeed.children.length > 6) {
      liveFeed.removeChild(liveFeed.lastElementChild);
    }
    // pulse ring only needs to exist for its one animation cycle
    const ring = rowEl.querySelector('.live-pulse-ring');
    if (ring) setTimeout(() => ring.remove(), 1000);
    updateSiteCard(item);
  }

  if (window.SimulationEngine) {
    window.SimulationEngine.onTick(handleLiveTick);
    window.SimulationEngine.start(2500); // 2.5 seconds per tick (faster live feed)
  }

  if (liveToggleBtn) {
    liveToggleBtn.addEventListener('click', () => {
      if (window.SimulationEngine) {
        const isRunning = window.SimulationEngine.togglePause();
        if (!isRunning) {
          liveToggleBtn.textContent = 'Resume';
          liveToggleBtn.classList.add('active');
          if (pulseDot) pulseDot.classList.add('paused');
        } else {
          liveToggleBtn.textContent = 'Pause';
          liveToggleBtn.classList.remove('active');
          if (pulseDot) pulseDot.classList.remove('paused');
        }
      }
    });
  }

  /* ---------------- Clickable Client Stat Box -> Modal ---------------- */
  const modal = document.getElementById('clientModal');
  const modalBody = document.getElementById('clientModalBody');
  const modalTitle = document.getElementById('clientModalTitle');
  const closeBtn = document.getElementById('clientModalClose');

  function openClientModal() {
    const clients = DATA.clients || [];
    const dataCenters = DATA.data_centers || [];
    const dcCountByClient = {};
    dataCenters.forEach(dc => {
      dcCountByClient[dc.client_id] = (dcCountByClient[dc.client_id] || 0) + 1;
    });

    modalTitle.textContent = `Clients (${clients.length})`;
    const clientImages = {
      'Nimbus Cloud Holdings': 'img/client-nimbus-orion.png',
      'Vertex Financial Group': 'img/client-vertex.png',
      'Orion Retail Systems': 'img/client-nimbus-orion.png'
    };
    modalBody.innerHTML = clients.map(c => `
      <div class="client-item client-item-visual">
        <img class="client-thumbnail" src="${clientImages[c.company_name] || 'img/client-nimbus-orion.png'}" alt="" />
        <div class="client-details">
          <p class="cname">${c.company_name}</p>
          <p class="crow"><b>Contact:</b> ${c.contact_name}</p>
          <p class="crow"><b>Email:</b> ${c.contact_email}</p>
          <p class="crow"><b>Contract since:</b> ${c.contract_start_date}</p>
          <p class="crow"><b>Sites:</b> ${dcCountByClient[c.id] || 0}</p>
        </div>
      </div>
    `).join('');
    modal.classList.add('open');
  }

  const clientsBox = document.getElementById('ovClientsBox');
  if (clientsBox) clientsBox.addEventListener('click', openClientModal);
  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

  return function refreshOverview(nextData) {
    DATA = nextData;
    const nextOverview = DATA.overview;
    document.getElementById('ovTotalSites').textContent = nextOverview.total_sites;
    document.getElementById('ovTotalClients').textContent = nextOverview.total_clients;

    const nextAlertDCs = new Set(DATA.alerts.filter(a => a.severity !== 'resolved').map(a => a.data_center_id));
    const nextAlertCount = DATA.alerts.filter(a => a.severity !== 'resolved').length;
    document.getElementById('ovActiveAlerts').textContent = nextAlertCount;
    document.getElementById('ovHealthySites').textContent = nextOverview.total_sites - nextAlertDCs.size;
    alertsBox?.classList.toggle('danger', nextAlertCount > 0);

    Object.entries(nextOverview.snapshot).forEach(([id, site]) => {
      const card = siteGrid.querySelector(`.site-card[data-dc-name="${site.name}"]`);
      if (!card) return;
      const isAlert = nextAlertDCs.has(Number(id));
      card.classList.toggle('alert', isAlert);
      const alertBadge = card.querySelector('.site-alert-badge');
      if (alertBadge) alertBadge.hidden = !isAlert;
      Object.entries(site.metrics).forEach(([metric, value]) => {
        const metricValue = card.querySelector(`.mini-metric[data-metric="${metric}"] b`);
        if (metricValue) metricValue.textContent = `${value}`;
        const metricRow = metricValue?.closest('.mini-metric');
        if (metricRow) {
          const isBreached = nextAlertDCs.has(Number(id)) && metric === 'flow_rate';
          metricRow.classList.toggle('flag', isBreached);
          const statusPill = metricRow.querySelector('.m-status-pill');
          if (statusPill) {
            statusPill.className = `m-status-pill ${isBreached ? 'status-breach' : 'status-ok'}`;
            statusPill.innerHTML = `<i class="fi ${isBreached ? 'fi-rr-triangle-warning' : 'fi-rr-check'}" aria-hidden="true"></i> ${isBreached ? 'Out of range' : 'Normal'}`;
          }
          const fill = metricRow.querySelector('.metric-mini-fill');
          if (fill) {
            fill.className = `metric-mini-fill ${isBreached ? 'fill-alert' : 'fill-ok'}`;
            fill.style.width = `${getRangePercent(metric, value)}%`;
          }
        }
      });
    });

    updateFleetBanner(nextAlertCount, nextOverview.total_sites - nextAlertDCs.size, nextOverview.total_sites, nextAlertDCs.size);
    Object.entries(nextOverview.snapshot)
      .sort(([aId, a], [bId, b]) => {
        const alertOrder = Number(nextAlertDCs.has(Number(bId))) - Number(nextAlertDCs.has(Number(aId)));
        return alertOrder || a.name.localeCompare(b.name);
      })
      .forEach(([id, site]) => {
        const card = siteGrid.querySelector(`.site-card[data-dc-id="${id}"]`);
        if (card) siteGrid.appendChild(card);
      });
  };
}
