/* Alert acknowledgement and resolution are shared backend state. */
async function initAlerts(DATA) {
  let ALERTS = DATA.alerts;
  const feed = document.getElementById('alertFeed');
  const filtersEl = document.getElementById('alertFilters');
  let activeFilter = 'all';
  let actions = {};
  let investigationController;

  function alertKey(alert) { return `${alert.sensor_code}|${alert.timestamp}`; }
  function actionState(alert) { return actions[alertKey(alert)] || { acknowledged: false, resolved: false }; }
  function displayedSeverity(alert) { return actionState(alert).resolved ? 'resolved' : alert.severity; }
  function investigationAlerts() {
    return ALERTS.map(alert => ({
      ...alert,
      displayedSeverity: displayedSeverity(alert),
      alertState: actionState(alert)
    }));
  }
  const { escapeHtml, timeAgo, formatTimestamp } = window.PulseDC.Utils;

  // Anchor relative time to the newest simulated alert, rather than the real clock.
  let SIMULATED_NOW = newestAlertTime(ALERTS);

  function newestAlertTime(alerts) {
    const timestamp = alerts.reduce((latest, alert) => !latest || alert.timestamp > latest ? alert.timestamp : latest, null);
    return timestamp ? new Date(timestamp.replace(' ', 'T')) : new Date();
  }

  function recommendation(alert, severity) {
    if (severity === 'resolved') return '<i class="fi fi-rr-check" aria-hidden="true"></i> Issue cleared: telemetry confirms operations are safely restored.';
    if (alert.metric_type === 'flow_rate') return '<i class="fi fi-rr-info" aria-hidden="true"></i> Action: Coolant pump flow is too low. Notify facility staff to check pump valve or filter blockage to prevent server overheating.';
    if (alert.metric_type === 'temperature') return '<i class="fi fi-rr-info" aria-hidden="true"></i> Action: Room temperature is rising. Check air conditioning (CRAC) units and verify server aisle doors are shut tight.';
    if (alert.metric_type === 'humidity') return '<i class="fi fi-rr-info" aria-hidden="true"></i> Action: Humidity is outside safe levels. Adjust humidification controls to prevent static discharge or moisture condensation.';
    if (alert.metric_type === 'pressure') return '<i class="fi fi-rr-info" aria-hidden="true"></i> Action: Pipe pressure variance detected. Check cooling pipe seals and pressure gauges for potential leaks.';
    return '<i class="fi fi-rr-info" aria-hidden="true"></i> Action: Review sensor readings and alert on-site operations team.';
  }

  function renderSummary() {
    document.getElementById('countCritical').textContent = ALERTS.filter(a => displayedSeverity(a) === 'critical').length;
    document.getElementById('countWarning').textContent = ALERTS.filter(a => displayedSeverity(a) === 'warning').length;
    document.getElementById('countResolved').textContent = ALERTS.filter(a => displayedSeverity(a) === 'resolved').length;
  }

  function renderFilters() {
    const options = [
      { id: 'all', label: 'All Issues' },
      { id: 'critical', label: 'Needs Urgent Action' },
      { id: 'warning', label: 'Watch Warnings' },
      { id: 'resolved', label: 'Resolved' }
    ];
    filtersEl.innerHTML = options.map(option => `
      <button class="filter-btn ${option.id === activeFilter ? 'active' : ''}" data-filter="${option.id}">${option.label}</button>
    `).join('');
    filtersEl.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => { activeFilter = btn.dataset.filter; renderFilters(); renderFeed(); });
    });
  }

  function filteredAlerts() {
    return ALERTS.filter(alert => {
      const severity = displayedSeverity(alert);
      return activeFilter === 'all' || severity === activeFilter;
    });
  }

  function renderFeed() {
    const list = filteredAlerts();
    if (!list.length) {
      feed.innerHTML = `
        <div style="text-align:center;padding:50px 20px;color:var(--text-secondary)">
          <div class="alert-empty-icon" aria-hidden="true"><i class="fi fi-rr-check"></i></div>
          <h3 style="margin:0 0 6px;color:var(--text-primary);font-size:16px">No issues in this view</h3>
          <p style="margin:0;font-size:13px;color:var(--text-muted)">Everything is running smoothly within normal operating thresholds.</p>
        </div>
      `;
      return;
    }
    feed.innerHTML = list.map(alert => {
      const state = actionState(alert);
      const severity = displayedSeverity(alert);
      const key = encodeURIComponent(alertKey(alert));
      
      // Determine clear 4-stage alert lifecycle:
      // 1. New / Unreviewed: neither acknowledged nor resolved, no review started
      // 2. Acknowledged: acknowledged by an operator
      // 3. Resolved: resolved
      let stageBadge = '<span class="alert-stage-pill stage-new"><i class="fi fi-rr-bell" aria-hidden="true"></i> New Incident</span>';
      let nextActionPrompt = 'Next step: Click <strong>Acknowledge</strong> to claim, then <strong>Review</strong> for root cause & fixes.';
      
      if (severity === 'resolved') {
        stageBadge = '<span class="alert-stage-pill stage-resolved"><i class="fi fi-rr-check" aria-hidden="true"></i> Resolved</span>';
        nextActionPrompt = 'Next step: No further action required. Reopen if symptoms return.';
      } else if (state.acknowledged) {
        stageBadge = `<span class="alert-stage-pill stage-ack"><i class="fi fi-rr-eye" aria-hidden="true"></i> Acknowledged${state.acknowledged_by ? ` (${escapeHtml(state.acknowledged_by)})` : ''}</span>`;
        nextActionPrompt = 'Next step: Follow guided checks in <strong>Assisted Fixes</strong>, then click <strong>Resolve</strong> once completed.';
      }

      const acknowledgement = state.acknowledged && severity !== 'resolved'
        ? `Claimed${state.acknowledged_by ? ` by ${escapeHtml(state.acknowledged_by)}` : ''}${state.acknowledged_at ? ` · ${escapeHtml(state.acknowledged_at)} UTC` : ''} · `
        : '';
      const resolution = state.resolved
        ? `<p class="alert-recommendation">Resolved${state.resolved_by ? ` by ${escapeHtml(state.resolved_by)}` : ''}${state.resolved_at ? ` · ${escapeHtml(state.resolved_at)} UTC` : ''}</p>`
        : '';
      const explainBtn = investigationController.buttonMarkup(alert.id);
      
      // Direct jump button to Site Explorer (drilldown)
      const siteExplorerBtn = `
        <button class="alert-action tertiary" data-jump-site="${escapeHtml(alert.data_center_id || '')}" data-jump-room="${escapeHtml(alert.room_id || '')}" data-jump-sensor="${escapeHtml(alert.sensor_id || '')}" data-jump-title="${escapeHtml(alert.dc_name)} - Room ${escapeHtml(alert.room_code)}" title="Inspect this room in Site Explorer">
          <i class="fi fi-rr-search"></i> Inspect Room
        </button>
      `;

      const actionsHtml = severity === 'resolved'
        ? `<div class="alert-action-group"><button class="alert-action secondary" data-alert-action="restore" data-alert-key="${key}">Reopen alert</button>${explainBtn}${siteExplorerBtn}</div>`
        : `<div class="alert-action-group">
            <button class="alert-action secondary" data-alert-action="acknowledge" data-alert-key="${key}" title="Claim ownership of this incident">${state.acknowledged ? 'Acknowledged' : 'Acknowledge'}</button>
            <button class="alert-action" data-alert-action="resolve" data-alert-key="${key}" title="Mark this incident as fixed">Resolve</button>
            ${explainBtn}
            ${siteExplorerBtn}
           </div>`;

      return `
        <div class="alert-row ${severity}">
          <div class="alert-header-line">
            <span class="sev-badge ${severity}">${escapeHtml(severity[0].toUpperCase() + severity.slice(1))}</span>
            ${stageBadge}
            <span class="alert-value-tag">${escapeHtml(alert.value)} ${escapeHtml(alert.unit)}</span>
          </div>
          <div class="alert-body">
            <p class="alert-title">${escapeHtml(alert.dc_name)} · Room ${escapeHtml(alert.room_code)} (${escapeHtml(alert.room_name)}) — ${escapeHtml(alert.description)}</p>
            <p class="alert-meta">${escapeHtml(alert.sensor_code)} · ${formatTimestamp(alert.timestamp)} · ${timeAgo(alert.timestamp, SIMULATED_NOW)} · ${escapeHtml(alert.client)} · ${escapeHtml(alert.location)}</p>
            <div class="alert-next-action-hint">${nextActionPrompt}</div>
            <p class="alert-recommendation">${acknowledgement}${recommendation(alert, severity)}</p>${resolution}
          </div>
          <div>${actionsHtml}</div>
        </div>
        `;
    }).join('');
  }

  const ALERT_API_BASE = window.PulseDC.API.getBaseUrl();

  try {
    const response = await fetch(`${ALERT_API_BASE}/api/alerts/actions`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load alert actions (${response.status}).`);
    actions = await response.json();
  } catch (error) {
    console.error('Could not load shared alert actions:', error);
    feed.innerHTML = '<p role="status">Alert action status could not be loaded. Check the backend connection and reload this page.</p>';
    return;
  }

  async function syncActionWithBackend(alert, actionType) {
    const response = await fetch(`${ALERT_API_BASE}/api/alerts/action`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensor_code: alert.sensor_code, timestamp: alert.timestamp, action: actionType })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Could not save alert action (${response.status}).`);
    }
  }

  feed.addEventListener('click', async event => {
    // Handle cross-navigation to Site Explorer
    const jumpBtn = event.target.closest('[data-jump-site]');
    if (jumpBtn) {
      const siteId = jumpBtn.dataset.jumpSite;
      const roomId = jumpBtn.dataset.jumpRoom;
      const sensorId = jumpBtn.dataset.jumpSensor;
      const title = jumpBtn.dataset.jumpTitle;
      const alertItem = ALERTS.find(a => String(a.data_center_id) === siteId);
      const clientId = alertItem ? alertItem.client_id : null;
      if (window.gotoDrilldown) {
        window.gotoDrilldown(clientId, siteId, roomId, sensorId, {
          page: 'alerts',
          label: 'Alerts & Incidents',
          alertTitle: title
        });
      }
      return;
    }

    const button = event.target.closest('[data-alert-action]');
    if (!button) return;
    const key = decodeURIComponent(button.dataset.alertKey);
    const alert = ALERTS.find(item => alertKey(item) === key);
    if (!alert) return;
    const action = button.dataset.alertAction;

    button.disabled = true;
    try {
      await syncActionWithBackend(alert, action);
      const response = await fetch(`${ALERT_API_BASE}/api/alerts/actions`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not reload alert actions (${response.status}).`);
      actions = await response.json();
      investigationController.setAlerts(investigationAlerts(), false);
      const cachedRuns = investigationController.getReport(alert.id)?.recent_investigations || [];
      if (cachedRuns.length) {
        const latestRun = cachedRuns[0];
        const state = actionState(alert);
        const actionLabels = { acknowledge: 'Acknowledged', resolve: 'Resolved', restore: 'Reopened' };
        const actedBy = action === 'resolve'
          ? state.resolved_by
          : action === 'acknowledge' ? state.acknowledged_by : state.resolved_by;
        const actedAt = action === 'resolve'
          ? state.resolved_at
          : action === 'acknowledge' ? state.acknowledged_at : state.resolved_at;
        latestRun.operator_actions = [...(latestRun.operator_actions || []), {
          action,
          label: actionLabels[action],
          acted_by: actedBy || 'Operator',
          acted_at: actedAt || new Date().toISOString()
        }];
        latestRun.operator_action = latestRun.operator_actions
          .map(item => `${item.label} by ${item.acted_by} · ${item.acted_at}`).join(' · ');
      }
    } catch (error) {
      console.error('Could not save alert action:', error);
      button.disabled = false;
      button.title = error.message;
      return;
    }

    renderSummary();
    renderFilters();
    renderFeed();

    // Notify other components (nav badge, overview cards)
    window.PulseDC?.EventBus?.emit('alerts:updated', {
      activeCount: ALERTS.filter(a => displayedSeverity(a) !== 'resolved').length
    });
  });

  investigationController = window.PulseDC.AlertInvestigation.create({
    feed,
    inbox: document.getElementById('investigationInbox'),
    detail: document.getElementById('investigationDetail'),
    alerts: investigationAlerts(),
    onStateChange: renderFeed,
    onNavigate: page => window.PulseDC.navigateToPage(page)
  });

  renderSummary();
  renderFilters();
  renderFeed();

  return async function refreshAlerts(nextData) {
    const priorIds = new Set(ALERTS.map(alert => String(alert.id)));
    ALERTS = nextData.alerts;
    SIMULATED_NOW = newestAlertTime(ALERTS);
    try {
      const response = await fetch(`${ALERT_API_BASE}/api/alerts/actions`, { credentials: 'include', cache: 'no-store' });
      if (response.ok) actions = await response.json();
    } catch (error) {
      console.error('Could not refresh saved alert actions:', error);
    }
    investigationController.setAlerts(investigationAlerts());
    renderSummary();
    renderFilters();
    renderFeed();
    window.PulseDC?.EventBus?.emit('alerts:updated', {
      activeCount: ALERTS.filter(alert => displayedSeverity(alert) !== 'resolved').length
    });
    const arrivingAlerts = ALERTS.filter(alert =>
      !priorIds.has(String(alert.id))
    );
    investigationController.investigateNew(arrivingAlerts);
  };
}
