/* ============================================================
   main.js — shared setup: loads crm/telemetry pipelines, wires up
   sidebar nav. Runs first; DATA and helper constants are used by
   every page script (overview.js, compare.js, drilldown.js, etc.)

   v2: data model is now Client -> Data Center -> Room -> Sensor ->
   Reading. Units are independent per sensor (read from the sensor
   record itself, not a global metric->unit table).
   ============================================================ */

let DATA = null;
let dashboardRefreshers = {};
let dashboardRefreshInProgress = false;

// API base is resolved centrally via PulseDC.API (core/utils.js, loaded first)
const DASHBOARD_API_BASE = window.PulseDC.API.getBaseUrl();
const AUTO_REFRESH_MS = 60000;
let latestTelemetryVersion = null;
let latestThresholdVersion = null;

const COLORS = ['#2F6FED', '#C43D3D', '#1E8E5A', '#B8860B', '#7F77DD', '#D85A30'];
// Fallback unit table — only used if a sensor record is somehow missing its own unit.
const UNITS = { flow_rate: 'L/min', temperature: '°C', humidity: '%RH', pressure: 'kPa' };
const METRICS = ['temperature', 'humidity', 'pressure', 'flow_rate'];

const cssVar = name => window.PulseDC.Utils.cssVar(name);

/* ---------------- theme toggle (persisted via localStorage) ---------------- */
function initTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById('themeSwitch');
  const knob = document.getElementById('themeKnob');
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');

  function apply(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
      toggle.classList.add('on');
      knob.innerHTML = '<i class="fi fi-rr-moon"></i>';
      icon.innerHTML = '<i class="fi fi-rr-moon"></i>';
      label.textContent = 'Dark';
    } else {
      root.removeAttribute('data-theme');
      toggle.classList.remove('on');
      knob.innerHTML = '<i class="fi fi-rr-sun"></i>';
      icon.innerHTML = '<i class="fi fi-rr-sun"></i>';
      label.textContent = 'Light';
    }
  }

  const saved = localStorage.getItem('sentinel-theme') || 'light';
  apply(saved);

  toggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    apply(next);
    localStorage.setItem('sentinel-theme', next);
  });
}

/* ---------------- sidebar navigation ---------------- */
function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateToPage(item.dataset.page);
    });
  });
  document.querySelectorAll('[data-page-link]').forEach(button => {
    button.addEventListener('click', () => navigateToPage(button.dataset.pageLink));
  });
  window.PulseDC.navigateToPage = navigateToPage;
}

function navigateToPage(pageName) {
  const page = document.getElementById(`page-${pageName}`);
  const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
  if (!page) return;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === navItem));
  document.querySelectorAll('.page').forEach(item => item.classList.toggle('active', item === page));
}

function updateAlertNavBadge(data) {
  const badge = document.getElementById('navAlertBadge');
  if (!badge) return;
  const activeAlerts = (data.alerts || []).filter(alert => alert.severity !== 'resolved').length;
  badge.textContent = activeAlerts;
  badge.hidden = activeAlerts === 0;
  badge.setAttribute('aria-label', `${activeAlerts} active alerts`);
}

/* ---------------- operating limits page ---------------- */
const THRESHOLD_LABELS = {
  flow_rate: 'Coolant flow rate', temperature: 'Room temperature',
  humidity: 'Air humidity', pressure: 'Coolant pressure'
};
let thresholdPageUser = null;
let thresholdPagePayload = null;
const isAdminRole = role => role === 'admin' || role === 'super_admin';

let thresholdPageScope = 'global';
let thresholdAuditEntries = [];

function renderThresholdSettings(thresholds, audit = []) {
  const canEdit = isAdminRole(thresholdPageUser?.role);
  const facilityId = thresholdPageScope === 'global' ? null : Number(thresholdPageScope);
  const overrideGroup = thresholdPagePayload?.facility_overrides?.[facilityId] || thresholdPagePayload?.facility_overrides?.[String(facilityId)] || {};
  const overrideSet = facilityId == null ? {} : (overrideGroup.thresholds || {});
  const cards = document.getElementById('thresholdCards');
  const saveButton = document.getElementById('thresholdSaveBtn');
  const resetButton = document.getElementById('thresholdResetBtn');
  const status = document.getElementById('thresholdSaveStatus');
  const historyList = document.getElementById('thresholdAuditList');
  const scopeSummary = document.getElementById('thresholdScopeSummary');
  const escape = window.PulseDC.Utils.escapeHtml;
  const facility = facilityId == null ? null : (DATA?.data_centers || []).find(dc => Number(dc.id) === facilityId);
  const facilitySensors = facilityId == null ? [] : (DATA?.sensors || []).filter(sensor => Number(sensor.data_center_id) === facilityId);
  const scopeLabel = facility ? facility.name : 'All facilities';
  scopeSummary.innerHTML = facility
    ? `<i class="fi fi-rr-building" aria-hidden="true"></i> ${escape(scopeLabel)} <span>Facility-specific ranges apply here. Unchanged metrics inherit fleet-wide limits.</span>`
    : `<i class="fi fi-rr-globe" aria-hidden="true"></i> Fleet-wide defaults <span>These ranges apply to every facility unless a facility has its own override.</span>`;
  cards.innerHTML = Object.entries(THRESHOLD_LABELS).map(([metric, label]) => {
    const globalRule = thresholdPagePayload?.thresholds?.[metric] || thresholds[metric] || {};
    const rule = facilityId == null ? globalRule : (overrideSet[metric] || globalRule);
    const margin = Number(rule.warning_margin ?? rule.warningMargin ?? 0);
    const unit = rule.unit || '';
    const min = rule.min == null ? null : Number(rule.min);
    const max = rule.max == null ? null : Number(rule.max);
    const hasOverride = Boolean(overrideSet[metric]);
    const liveValues = facilitySensors
      .filter(sensor => sensor.metric_type === metric)
      .map(sensor => Number(DATA?.drilldown?.data_centers?.find(dc => Number(dc.id) === facilityId)?.rooms?.flatMap(room => room.sensors || []).find(item => Number(item.id) === Number(sensor.id))?.current))
      .filter(Number.isFinite);
    const currentValue = liveValues.length ? liveValues.reduce((sum, value) => sum + value, 0) / liveValues.length : null;
    const currentDisplay = currentValue == null ? 'No live reading' : `${currentValue.toFixed(2)} ${unit}`;
    const currentMarker = min != null && max != null && max > min && currentValue != null
      ? `<span class="limit-current-marker" style="--marker-position:${Math.min(100, Math.max(0, (currentValue - min) / (max - min) * 100))}%" title="Current facility average: ${escape(currentDisplay)}"></span>`
      : '';
    const values = `<div class="limit-fields">
      <label>Minimum <span>${escape(unit)}</span><input data-threshold-metric="${metric}" data-threshold-field="min" type="number" step="any" value="${min == null ? '' : escape(String(min))}" placeholder="No minimum" ${canEdit ? '' : 'disabled'}></label>
      <label>Maximum <span>${escape(unit)}</span><input data-threshold-metric="${metric}" data-threshold-field="max" type="number" step="any" value="${max == null ? '' : escape(String(max))}" placeholder="No maximum" ${canEdit ? '' : 'disabled'}></label>
      <label>Warning begins within <span>${escape(unit)}</span><input data-threshold-metric="${metric}" data-threshold-field="warning_margin" type="number" min="0" step="any" value="${escape(String(margin))}" ${canEdit ? '' : 'disabled'}></label>
    </div>`;
    const width = min != null && max != null && max > min ? max - min : Math.max(Math.abs(max ?? min ?? 100) * 0.5, 1);
    const warningPct = Math.min(45, Math.max(8, margin / width * 100));
    const range = min != null && max != null
      ? `<div class="limit-range" aria-label="Safe range from ${min} to ${max} ${escape(unit)}"><span class="limit-warning-band" style="--warning-width:${warningPct}%"></span><span class="limit-safe-band"></span><span class="limit-warning-band" style="--warning-width:${warningPct}%"></span>${currentMarker}</div><div class="limit-range-labels"><span>${escape(String(min))} ${escape(unit)}</span><span>Safe range</span><span>${escape(String(max))} ${escape(unit)}</span></div>${facility ? `<p class="limit-current-value"><span class="limit-current-key"></span> Current facility average: <strong>${escape(currentDisplay)}</strong></p>` : ''}`
      : `<div class="limit-one-sided"><i class="fi fi-rr-shield-check" aria-hidden="true"></i> ${min == null ? `Must stay below ${escape(String(max))} ${escape(unit)}` : `Must stay above ${escape(String(min))} ${escape(unit)}`}</div>`;
    const comparison = facility && hasOverride
      ? `<p class="limit-default-comparison">Fleet default: <strong>${globalRule.min == null ? 'No minimum' : escape(String(globalRule.min))} to ${globalRule.max == null ? 'No maximum' : escape(String(globalRule.max))} ${escape(unit)}</strong> · warning margin ${escape(String(globalRule.warning_margin ?? globalRule.warningMargin ?? 0))} ${escape(unit)}</p>`
      : '';
    const metricIcon = metric === 'temperature' ? 'fi-rr-thermometer-half'
      : metric === 'humidity' ? 'fi-rr-raindrops'
        : metric === 'pressure' ? 'fi-rr-dashboard'
          : 'fi-rr-water';
    return `<article class="limit-card"><div class="limit-card-heading"><div><span class="limit-card-icon"><i class="fi ${metricIcon}" aria-hidden="true"></i></span><h2>${escape(label)}</h2></div><span class="limit-source ${hasOverride ? 'custom' : ''}">${hasOverride ? 'Customized here' : 'Fleet default'}</span></div>${range}<p class="limit-warning-note">Warning starts within <strong>${escape(String(margin))} ${escape(unit)}</strong> of the limit.</p>${comparison}${canEdit ? values : ''}</article>`;
  }).join('');

  saveButton.hidden = !canEdit;
  resetButton.hidden = !canEdit || facilityId == null || Object.keys(overrideSet).length === 0;
  status.textContent = canEdit ? 'Changes are recorded in the history below.' : 'View only · ask an administrator to change operating limits.';
  const parseAuditValue = raw => {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  };
  const ruleText = raw => {
    const values = parseAuditValue(raw);
    if (values == null) return 'no previous override';
    if (values === 'REVERT_TO_GLOBAL') return 'reverted to global limits';
    if (typeof values !== 'object') return String(values);
    const low = values.min == null ? 'no minimum' : values.min;
    const high = values.max == null ? 'no maximum' : values.max;
    const margin = values.warning_margin == null ? 'unspecified' : values.warning_margin;
    return `${low} to ${high}; warning margin ${margin}`;
  };
  thresholdAuditEntries = audit;
  const isSuperAdmin = thresholdPageUser?.role === 'super_admin';

  historyList.innerHTML = audit.length
    ? audit.map((entry, index) => {
      const scope = entry.scope_type === 'facility' ? (entry.data_center_name || 'Facility') : 'All facilities';
      const revertBtn = isSuperAdmin
        ? `<button type="button" class="btn-audit-revert" data-audit-idx="${index}" title="Roll back to previous safe limits using Super Admin authorization"><i class="fi fi-rr-undo" aria-hidden="true"></i> Revert</button>`
        : '';
      return `<li data-audit-index="${index}" data-audit-scope="${entry.scope_type === 'facility' ? String(entry.data_center_id) : 'global'}" data-audit-metric="${escape(entry.metric_type || '')}" data-audit-search="${escape(`${scope} ${THRESHOLD_LABELS[entry.metric_type] || entry.metric_type || ''} ${ruleText(entry.old_values)} ${ruleText(entry.new_values)} ${entry.changed_by || ''} ${entry.changed_at || ''}`.toLowerCase())}"><strong>${escape(scope)} · ${escape(THRESHOLD_LABELS[entry.metric_type] || entry.metric_type)}</strong><span>${escape(ruleText(entry.old_values))} <i class="fi fi-rr-arrow-right" aria-hidden="true"></i> ${escape(ruleText(entry.new_values))}</span><small>${entry.changed_by ? escape(entry.changed_by) : 'Administrator'}${entry.changed_at ? ` · ${escape(entry.changed_at)}` : ''}</small>${revertBtn}</li>`;
    }).join('')
    : '<li class="limits-history-empty">No saved changes yet. Updates will appear here.</li>';

  // Wire up Revert buttons to trigger the ADK Human-in-the-Loop workflow directly
  historyList.querySelectorAll('.btn-audit-revert').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.auditIdx);
      const entry = thresholdAuditEntries[idx];
      if (!entry) return;

      const scopeName = entry.scope_type === 'facility' ? (entry.data_center_name || 'facility') : 'all facilities';
      const promptText = `Revert ${entry.metric_type} on ${scopeName} to previous limits`;
      
      // Open chatbot panel and dispatch the revert prompt
      const bubble = document.getElementById('chatBubble');
      const panel = document.getElementById('chatPanel');
      if (panel && !panel.classList.contains('open')) {
        bubble?.click();
      }
      
      const chatInput = document.getElementById('chatInput');
      const chatSendBtn = document.getElementById('chatSendBtn');
      if (chatInput && chatSendBtn) {
        chatInput.value = promptText;
        chatSendBtn.click();
      }
    });
  });

  renderThresholdAuditFilters(audit);
}

function renderThresholdAuditFilters(audit = thresholdAuditEntries) {
  const facilityFilter = document.getElementById('thresholdHistoryFacility');
  const metricFilter = document.getElementById('thresholdHistoryMetric');
  if (!facilityFilter || !metricFilter) return;
  const currentFacility = facilityFilter.value || 'all';
  const currentMetric = metricFilter.value || 'all';
  const facilities = new Map();
  audit.forEach(entry => {
    if (entry.scope_type === 'facility' && entry.data_center_id != null) {
      facilities.set(String(entry.data_center_id), entry.data_center_name || `Facility ${entry.data_center_id}`);
    }
  });
  facilityFilter.innerHTML = '<option value="all">All facilities</option><option value="global">Fleet-wide changes</option>' +
    Array.from(facilities, ([id, name]) => `<option value="${id}">${window.PulseDC.Utils.escapeHtml(name)}</option>`).join('');
  facilityFilter.value = facilities.has(currentFacility) || currentFacility === 'all' || currentFacility === 'global' ? currentFacility : 'all';
  metricFilter.innerHTML = '<option value="all">All sensor types</option>' +
    Object.entries(THRESHOLD_LABELS).map(([metric, label]) => `<option value="${metric}">${window.PulseDC.Utils.escapeHtml(label)}</option>`).join('');
  metricFilter.value = Object.prototype.hasOwnProperty.call(THRESHOLD_LABELS, currentMetric) || currentMetric === 'all' ? currentMetric : 'all';
  applyThresholdAuditFilters();
}

function applyThresholdAuditFilters() {
  const list = document.getElementById('thresholdAuditList');
  const rows = Array.from(list.querySelectorAll('li[data-audit-index]'));
  const facility = document.getElementById('thresholdHistoryFacility').value;
  const metric = document.getElementById('thresholdHistoryMetric').value;
  const query = document.getElementById('thresholdHistorySearch').value.trim().toLowerCase();
  let visible = 0;
  rows.forEach(row => {
    const matches = (facility === 'all' || row.dataset.auditScope === facility)
      && (metric === 'all' || row.dataset.auditMetric === metric)
      && (!query || row.dataset.auditSearch.includes(query));
    row.hidden = !matches;
    if (matches) visible++;
  });
  const count = document.getElementById('thresholdHistoryCount');
  count.textContent = rows.length
    ? `${facility === 'all' && metric === 'all' && !query ? `Showing ${rows.length} changes` : `Showing ${visible} of ${rows.length} changes`}`
    : '';
  let empty = list.querySelector('.limits-history-filter-empty');
  if (!empty) {
    empty = document.createElement('li');
    empty.className = 'limits-history-empty limits-history-filter-empty';
    empty.textContent = 'No changes match these filters. Try changing or clearing your filters.';
    list.appendChild(empty);
  }
  empty.hidden = visible > 0 || rows.length === 0;
}

async function loadThresholdSettings(user, options = {}) {
  const status = document.getElementById('thresholdSaveStatus');
  try {
    const query = thresholdPageScope === 'global' ? '' : `?data_center_id=${encodeURIComponent(thresholdPageScope)}`;
    const response = await fetch(`${DASHBOARD_API_BASE}/api/thresholds${query}`, {
      credentials: 'include', cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not load sensor limits (${response.status}).`);
    const previousOverrides = thresholdPagePayload?.facility_overrides || {};
    thresholdPagePayload = payload;
    window.ThresholdEngine?.setThresholds(payload.thresholds);
    if (payload.facility_overrides) {
      window.ThresholdEngine?.setFacilityThresholds(payload.facility_overrides);
    } else if (thresholdPageScope !== 'global') {
      const scoped = {};
      scoped[thresholdPageScope] = {
        thresholds: Object.fromEntries(Object.entries(payload.overrides || {}).map(([metric, rule]) => [metric, rule]))
      };
      window.ThresholdEngine?.setFacilityThresholds(scoped, { replace: false });
    }
    const effective = payload.effective_thresholds || payload.thresholds || {};
    if (thresholdPageScope !== 'global' && !payload.facility_overrides) {
      thresholdPagePayload.facility_overrides = {
        ...previousOverrides,
        [String(thresholdPageScope)]: { thresholds: payload.overrides || {} }
      };
      const scoped = { [String(thresholdPageScope)]: { thresholds: payload.overrides || {} } };
      window.ThresholdEngine?.setFacilityThresholds(scoped, { replace: false });
    }
    renderThresholdSettings(effective, payload.audit || []);
  } catch (error) {
    status.textContent = error.message;
    document.getElementById('thresholdCards').innerHTML = `<p class="meta">Operating limits could not be loaded. ${window.PulseDC.Utils.escapeHtml(error.message)}</p>`;
    document.getElementById('thresholdAuditList').innerHTML = '<li class="limits-history-empty">Change history is unavailable.</li>';
  }
}

function initOperatingLimits(user) {
  thresholdPageUser = user;
  document.getElementById('thresholdSaveStatus').textContent = isAdminRole(user.role)
    ? 'Changes are recorded in the history below.'
    : 'View only · ask an administrator to change operating limits.';
  document.querySelectorAll('.threshold-link').forEach(btn => btn.addEventListener('click', () => {
    navigateToPage('thresholds');
    document.getElementById('thresholdSaveStatus').textContent = 'Loading saved operating limits…';
    loadThresholdSettings(user);
  }));
  const scopeSelect = document.getElementById('thresholdScopeSelect');
  scopeSelect.innerHTML = `<option value="global">All facilities</option>${(DATA?.data_centers || []).map(dc => `<option value="${Number(dc.id)}">${window.PulseDC.Utils.escapeHtml(dc.name)}${dc.location ? ` · ${window.PulseDC.Utils.escapeHtml(dc.location)}` : ''}</option>`).join('')}`;
  scopeSelect.addEventListener('change', () => {
    thresholdPageScope = scopeSelect.value;
    document.getElementById('thresholdSaveStatus').textContent = 'Loading saved operating limits…';
    document.getElementById('thresholdCards').innerHTML = '';
    loadThresholdSettings(user);
  });
  document.querySelector('.nav-item[data-page="thresholds"]')?.addEventListener('click', () => loadThresholdSettings(user));
  document.getElementById('thresholdEditHint').hidden = !isAdminRole(user.role);
  const historyFacility = document.getElementById('thresholdHistoryFacility');
  const historyMetric = document.getElementById('thresholdHistoryMetric');
  const historySearch = document.getElementById('thresholdHistorySearch');
  historyFacility.addEventListener('change', applyThresholdAuditFilters);
  historyMetric.addEventListener('change', applyThresholdAuditFilters);
  historySearch.addEventListener('input', applyThresholdAuditFilters);
  document.getElementById('thresholdHistoryClear').addEventListener('click', () => {
    historyFacility.value = 'all';
    historyMetric.value = 'all';
    historySearch.value = '';
    applyThresholdAuditFilters();
  });
  document.getElementById('thresholdSaveBtn').addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = document.getElementById('thresholdSaveStatus');
    if (!isAdminRole(user.role)) return;
    if (button.disabled) return;
    const thresholds = {};
    let invalidInput = false;
    const overrideGroup = thresholdPagePayload?.facility_overrides?.[thresholdPageScope]
      || thresholdPagePayload?.facility_overrides?.[Number(thresholdPageScope)] || {};
    const source = thresholdPageScope === 'global' ? (thresholdPagePayload?.thresholds || {}) : (overrideGroup.thresholds || {});
    Object.keys(THRESHOLD_LABELS).forEach(metric => { thresholds[metric] = { ...(source[metric] || thresholdPagePayload?.thresholds?.[metric] || {}) }; });
    document.querySelectorAll('[data-threshold-metric]').forEach(input => {
      const metric = input.dataset.thresholdMetric;
      const field = input.dataset.thresholdField;
      const rawValue = input.value.trim();
      if (field === 'warning_margin' && (rawValue === '' || !Number.isFinite(Number(rawValue)) || Number(rawValue) < 0)) invalidInput = true;
      if (rawValue !== '' && !Number.isFinite(Number(rawValue))) invalidInput = true;
      thresholds[metric][field] = field !== 'warning_margin' && rawValue === '' ? null : Number(rawValue);
    });

    if (invalidInput) {
      status.textContent = 'Enter valid numbers for all limits. Warning margins must be zero or greater.';
      return;
    }

    button.disabled = true;
    status.textContent = 'Saving limits…';
    try {
      const facilityId = thresholdPageScope === 'global' ? null : thresholdPageScope;
      const response = await fetch(facilityId ? `${DASHBOARD_API_BASE}/api/thresholds/facilities/${encodeURIComponent(facilityId)}` : `${DASHBOARD_API_BASE}/api/thresholds`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(facilityId ? { overrides: thresholds } : { thresholds })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not save sensor limits (${response.status}).`);
      await loadThresholdSettings(user);
      await window.PulseDC.refreshDashboard();
      status.textContent = facilityId ? 'Facility limits saved. Alerts and forecasts will use them for this facility.' : 'Fleet-wide limits saved. Alerts and forecasts now use the updated settings.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('thresholdResetBtn').addEventListener('click', async event => {
    if (!isAdminRole(user.role) || thresholdPageScope === 'global') return;
    if (event.currentTarget.disabled) return;
    const button = event.currentTarget;
    const status = document.getElementById('thresholdSaveStatus');
    button.disabled = true;
    status.textContent = 'Restoring fleet-wide limits…';
    try {
      const response = await fetch(`${DASHBOARD_API_BASE}/api/thresholds/facilities/${encodeURIComponent(thresholdPageScope)}`, { method: 'DELETE', credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not restore defaults (${response.status}).`);
      await loadThresholdSettings(user);
      await window.PulseDC.refreshDashboard();
      status.textContent = 'Facility limits reset. This facility now inherits fleet-wide ranges.';
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = false; }
  });
}

/* ---------------- pipeline federation & boot sequence ----------------
   Fetches from separate CRM (identity/metadata: clients, data centers,
   rooms, sensors) and Telemetry (raw readings) pipelines independently,
   federating them at runtime into a unified view object for pages. */
function newestReadingTimestamp(payload) {
  const readings = payload.telemetry?.readings || [];
  return readings.length ? readings[readings.length - 1].timestamp : null;
}

function telemetryPayloadVersion(payload) {
  const readings = payload.telemetry?.readings || [];
  return readings.reduce((latestId, reading) => Math.max(latestId, Number(reading.id) || 0), 0)
    || newestReadingTimestamp(payload);
}

function backtestForecast(values, timestamps, horizonSteps = 96, minimumTrainingSteps = 192, originStride = 96) {
  if (!window.ForecastEngine || values.length < minimumTrainingSteps + horizonSteps) {
    return { horizon_hours: 24, count: 0, mae: null, samples: [] };
  }
  const samples = [];
  for (let origin = minimumTrainingSteps; origin + horizonSteps - 1 < values.length; origin += originStride) {
    const training = values.slice(0, origin);
    const targetIndex = origin + horizonSteps - 1;
    const { slope, intercept } = window.ForecastEngine.calculateLinearRegression(
      training.map((value, index) => ({ x: index, y: value }))
    );
    const predicted = slope * (training.length - 1 + horizonSteps) + intercept;
    const actual = values[targetIndex];
    samples.push({
      timestamp: timestamps[targetIndex] || null,
      predicted: Math.round(predicted * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      absolute_error: Math.round(Math.abs(predicted - actual) * 100) / 100
    });
  }
  return {
    horizon_hours: horizonSteps / 4,
    count: samples.length,
    mae: samples.length
      ? Math.round(samples.reduce((sum, sample) => sum + sample.absolute_error, 0) / samples.length * 100) / 100
      : null,
    samples
  };
}

async function requestDashboardPayload() {
  const response = await fetch(`${DASHBOARD_API_BASE}/api/dashboard-data`, {
    credentials: 'include',
    cache: 'no-store'
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Dashboard data request failed (${response.status}).`);
  }

  const payload = await response.json();
  const { crm, telemetry } = payload;
  if (!crm || !telemetry || !Array.isArray(crm.clients) || !Array.isArray(telemetry.readings)) {
    throw new Error('The dashboard API returned an invalid data payload.');
  }
  if (!payload.thresholds || !['flow_rate', 'temperature', 'humidity', 'pressure'].every(metric => payload.thresholds[metric])) {
    throw new Error('The backend did not provide a complete sensor threshold configuration. Restart the backend to apply the latest updates.');
  }
  return payload;
}

async function fetchAndFederatePipelines(payload = null) {
  payload = payload || await requestDashboardPayload();
  const { crm, telemetry } = payload;
  if (payload.thresholds) window.ThresholdEngine?.setThresholds(payload.thresholds);
  window.ThresholdEngine?.setFacilityThresholds(payload.facility_thresholds);

  const clientMap = new Map(crm.clients.map(c => [c.id, c]));
  const dcMap = new Map(crm.data_centers.map(dc => [dc.id, dc]));
  const roomMap = new Map(crm.rooms.map(r => [r.id, r]));
  const sensorMap = new Map(crm.sensors.map(s => [s.id, s]));

  // Enrich each room/sensor with denormalized parent info so every page
  // can render "DC · Room · Sensor" labels without re-joining every time.
  crm.rooms.forEach(r => {
    const dc = dcMap.get(r.data_center_id);
    r.dc_name = dc ? dc.name : 'Unknown';
    r.dc_location = dc ? dc.location : '';
    r.client_id = dc ? dc.client_id : null;
    r.client_name = dc && clientMap.has(dc.client_id) ? clientMap.get(dc.client_id).company_name : 'Unknown';
  });
  crm.sensors.forEach(s => {
    const room = roomMap.get(s.room_id);
    s.room_name = room ? room.name : 'Unknown';
    s.room_code = room ? room.room_code : '';
    s.floor_level = room ? room.floor_level : '';
    s.data_center_id = room ? room.data_center_id : null;
    s.dc_name = room ? room.dc_name : 'Unknown';
    s.location = room ? room.dc_location : '';
    s.client_name = room ? room.client_name : 'Unknown';
  });

  // ---------------------------------------------------------------
  // Readings grouped per sensor, sorted chronologically
  // ---------------------------------------------------------------
  const readingsBySensor = {};
  telemetry.readings.forEach(r => {
    (readingsBySensor[r.sensor_id] = readingsBySensor[r.sensor_id] || []).push(r);
  });
  Object.values(readingsBySensor).forEach(series => series.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));

  function describeAlert(metricType, status, value, dataCenterId) {
    const rule = window.ThresholdEngine ? window.ThresholdEngine.getRule(metricType, dataCenterId) : null;
    const label = metricType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (status === 'resolved') return `${label} recovered to normal range`;
    if (status === 'critical') {
      return rule && rule.min !== null && value < rule.min
        ? `${label} dropped below safe threshold`
        : `${label} exceeded safe threshold`;
    }
    return `${label} trending toward unsafe range`;
  }

  // ---------------------------------------------------------------
  // Alerts: log an event only when a SENSOR actually changes status
  // (healthy -> warning -> critical -> back to healthy), confirmed
  // over several consecutive readings so momentary noise doesn't
  // spam the feed. One entry per episode, per sensor.
  // ---------------------------------------------------------------
  const alerts = [];
  const CONFIRM_READINGS = 5;

  Object.entries(readingsBySensor).forEach(([sensorId, series]) => {
    const sensor = sensorMap.get(Number(sensorId));
    if (!sensor) return;
    let confirmedStatus = 'ok';
    let candidateStatus = null;
    let candidateCount = 0;

    series.forEach(r => {
      const status = window.ThresholdEngine
        ? window.ThresholdEngine.evaluateMetricStatus(sensor.metric_type, r.value, sensor.data_center_id)
        : 'ok';

      if (status === confirmedStatus) {
        candidateStatus = null;
        candidateCount = 0;
        return;
      }
      if (status === candidateStatus) {
        candidateCount++;
      } else {
        candidateStatus = status;
        candidateCount = 1;
      }

      if (candidateCount >= CONFIRM_READINGS) {
        const finalSeverity = status === 'ok' ? 'resolved' : status;
        alerts.push({
          id: r.id,
          sensor_id: sensor.id,
          sensor_code: sensor.sensor_code,
          sensor_name: sensor.name,
          data_center_id: sensor.data_center_id,
          dc_name: sensor.dc_name,
          room_id: sensor.room_id,
          room_name: sensor.room_name,
          room_code: sensor.room_code,
          floor_level: sensor.floor_level,
          location: sensor.location,
          client: sensor.client_name,
          metric_type: sensor.metric_type,
          value: r.value,
          unit: sensor.unit,
          timestamp: r.timestamp,
          severity: finalSeverity,
          description: describeAlert(sensor.metric_type, finalSeverity, r.value, sensor.data_center_id)
        });
        confirmedStatus = status;
        candidateStatus = null;
        candidateCount = 0;
      }
    });
  });
  alerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // ---------------------------------------------------------------
  // Per-sensor computed stats: latest, min/max/avg, trend, history
  // ---------------------------------------------------------------
  const sensorStats = {};
  crm.sensors.forEach(sensor => {
    const series = (readingsBySensor[sensor.id] || []).map(r => r.value);
    const sparkline = series.length > 0 ? series.slice(-40) : [0];
    const lastVal = sparkline[sparkline.length - 1];
    const minVal = Math.min(...sparkline);
    const maxVal = Math.max(...sparkline);
    const avgVal = sparkline.reduce((a, b) => a + b, 0) / sparkline.length;

    let trend = 'stable';
    if (sparkline.length >= 2) {
      const diff = lastVal - sparkline[0];
      const status = window.ThresholdEngine ? window.ThresholdEngine.evaluateMetricStatus(sensor.metric_type, lastVal, sensor.data_center_id) : 'ok';
      if (diff < -2.0 || status === 'critical') trend = 'down';
      else if (diff > 2.0) trend = 'up';
    }

    sensorStats[sensor.id] = {
      latest: Math.round(lastVal * 100) / 100,
      current: Math.round(lastVal * 100) / 100,
      min: Math.round(minVal * 100) / 100,
      max: Math.round(maxVal * 100) / 100,
      avg: Math.round(avgVal * 100) / 100,
      trend,
      status: window.ThresholdEngine ? window.ThresholdEngine.evaluateMetricStatus(sensor.metric_type, lastVal, sensor.data_center_id) : 'ok',
      sparkline,
      history: sparkline,
      // Full available series (up to ~7 days), used ONLY for forecasting.
      // The 40-point sparkline above is a ~10-hour window — fine for
      // display and current/min/max/avg, but far too short and noisy a
      // window to fit a slope that then gets extrapolated 7 days out
      // (that amplifies short-term wiggle into a dramatic fake trend).
      fullHistory: series,
      fullTimestamps: (readingsBySensor[sensor.id] || []).map(reading => reading.timestamp)
    };
  });

  // ---------------------------------------------------------------
  // Overview: DC-level rollup. Each DC now has several sensors per
  // metric type (one per room), so the site card shows the AVERAGE
  // across that DC's sensors for each metric — still one number per
  // metric for a scannable summary, but grounded in real per-sensor data.
  // ---------------------------------------------------------------
  const siteSnapshots = {};
  crm.data_centers.forEach(dc => {
    siteSnapshots[dc.id] = {
      name: dc.name,
      client: clientMap.has(dc.client_id) ? clientMap.get(dc.client_id).company_name : 'Unknown',
      location: dc.location,
      metrics: {}
    };
  });
  METRICS.forEach(metric => {
    const bucket = {}; // dc_id -> [values]
    crm.sensors.filter(s => s.metric_type === metric).forEach(s => {
      const val = sensorStats[s.id].current;
      (bucket[s.data_center_id] = bucket[s.data_center_id] || []).push(val);
    });
    Object.entries(bucket).forEach(([dcId, vals]) => {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (siteSnapshots[dcId]) siteSnapshots[dcId].metrics[metric] = Math.round(avg * 100) / 100;
    });
  });

  const unhealthySiteIds = new Set(
    crm.sensors.filter(s => sensorStats[s.id].status !== 'ok').map(s => s.data_center_id)
  );

  const overview = {
    total_sites: crm.data_centers.length,
    total_clients: crm.clients.length,
    total_rooms: crm.rooms.length,
    total_sensors: crm.sensors.length,
    snapshot: siteSnapshots,
    feed: telemetry.readings.slice(-20).reverse().map(r => {
      const s = sensorMap.get(r.sensor_id);
      const sev = s ? window.ThresholdEngine.evaluateMetricStatus(s.metric_type, r.value, s.data_center_id) : 'ok';
      return {
        sensor_id: r.sensor_id,
        dc_name: s ? s.dc_name : 'Unknown',
        room_name: s ? s.room_name : 'Unknown',
        location: s ? s.location : '',
        metric_type: s ? s.metric_type : '',
        unit: s ? s.unit : '',
        value: r.value,
        is_alert: sev !== 'ok',
        severity: sev
      };
    }),
    unhealthy_site_ids: Array.from(unhealthySiteIds)
  };

  // ---------------------------------------------------------------
  // Drilldown: Client -> Data Center -> Room -> Sensor hierarchy
  // ---------------------------------------------------------------
  const drilldownDCs = crm.data_centers.map(dc => {
    const dcRooms = crm.rooms.filter(r => r.data_center_id === dc.id).map(room => {
      const roomSensors = crm.sensors.filter(s => s.room_id === room.id).map(sensor => ({
        id: sensor.id,
        sensor_code: sensor.sensor_code,
        serial_id: sensor.serial_id,
        name: sensor.name,
        metric_type: sensor.metric_type,
        unit: sensor.unit,
        ...sensorStats[sensor.id]
      }));
      return {
        id: room.id,
        room_code: room.room_code,
        name: room.name,
        room_type: room.room_type,
        floor_level: room.floor_level,
        sensors: roomSensors
      };
    });
    return {
      id: dc.id,
      client_id: dc.client_id,
      name: dc.name,
      client: clientMap.has(dc.client_id) ? clientMap.get(dc.client_id).company_name : 'Unknown',
      location: dc.location,
      rooms: dcRooms
    };
  });

  // ---------------------------------------------------------------
  // Compare: two modes.
  //  - byMetric: overlay the SAME metric across different rooms (any DC)
  //  - byRoom: small multiples of every sensor WITHIN one room
  // ---------------------------------------------------------------
  const compareByMetric = {};
  METRICS.forEach(metric => { compareByMetric[metric] = []; });
  crm.sensors.forEach(sensor => {
    compareByMetric[sensor.metric_type].push({
      key: sensor.sensor_code,
      label: `${sensor.dc_name} · ${sensor.room_name}`,
      dc_name: sensor.dc_name,
      room_name: sensor.room_name,
      room_id: sensor.room_id,
      room_code: sensor.room_code,
      unit: sensor.unit,
      history: sensorStats[sensor.id].history
    });
  });

  const compareByRoom = {};
  crm.rooms.forEach(room => {
    compareByRoom[room.id] = {
      room_label: `${room.dc_name} · ${room.name} (Room ${room.room_code}, ${room.floor_level})`,
      dc_name: room.dc_name,
      room_name: room.name,
      sensors: crm.sensors.filter(s => s.room_id === room.id).map(sensor => ({
        sensor_code: sensor.sensor_code,
        name: sensor.name,
        metric_type: sensor.metric_type,
        unit: sensor.unit,
        history: sensorStats[sensor.id].history
      }))
    };
  });

  const roomsList = crm.rooms.map(r => ({
    id: r.id, data_center_id: r.data_center_id, dc_name: r.dc_name,
    room_code: r.room_code, name: r.name, room_type: r.room_type, floor_level: r.floor_level
  }));

  // ---------------------------------------------------------------
  // Forecast: per-sensor linear regression, rolled up to a per-DC
  // ranking (worst sensor decides the site's overall risk).
  //
  // IMPORTANT: readings are taken every 15 minutes, so there are 96
  // readings per real day (24 * 60 / 15). Both the "Projected (7d)"
  // stat AND the chart's dashed projection line are derived from the
  // SAME single regression call, using this real interval — previously
  // these were two separate calculations with two different (both
  // wrong) time scales, which could disagree on direction/magnitude.
  // ---------------------------------------------------------------
  const READINGS_PER_DAY = 96; // 24h * 60min / 15min interval
  const forecastSensors = {};
  const forecastHist = {};
  crm.sensors.forEach(sensor => {
    const displayHistory = sensorStats[sensor.id].history; // ~10hr sparkline, for the chart's "actual" line
    const fullHistory = sensorStats[sensor.id].fullHistory; // up to 7 days, for fitting the trend slope
    const currentVal = sensorStats[sensor.id].current;
    const fullTimestamps = sensorStats[sensor.id].fullTimestamps;

    // Fit the regression on the FULL history (not the short sparkline) so
    // the slope reflects the real multi-day trend rather than a random
    // wiggle in the last few hours. Extrapolating a short-window slope
    // 7 days out would massively amplify noise into a fake dramatic trend.
    const regressionInput = fullHistory && fullHistory.length >= 10 ? fullHistory : displayHistory;
    const sevenDaySteps = READINGS_PER_DAY * 7;
    const result = window.ForecastEngine
      ? window.ForecastEngine.forecastMetricTrend(regressionInput, sensor.metric_type, sevenDaySteps, sensor.data_center_id)
      : { slope: 0, intercept: currentVal, predictedValue: currentVal, riskLevel: 'low' };

    const risk = result.riskLevel === 'high' ? 'high' : (result.riskLevel === 'medium' ? 'watch' : 'stable');
    const projectedVal = result.predictedValue;
    const change = projectedVal - currentVal;
    const relativeChange = Math.abs(currentVal) > 0.01 ? Math.abs(change) / Math.abs(currentVal) : 0;
    const trendDir = relativeChange < 0.01 ? 'flat' : (change < 0 ? 'down' : 'up');

    // already_crossed: the current live reading is already outside its safe band
    const threshold = window.ThresholdEngine ? window.ThresholdEngine.getRule(sensor.metric_type, sensor.data_center_id) : null;
    const alreadyCrossed = threshold
      ? ((threshold.min !== null && currentVal < threshold.min) ||
        (threshold.max !== null && currentVal > threshold.max))
      : false;

    // days_to_threshold: estimate days until projected value hits the nearest boundary
    // derived from the regression slope so it's consistent with the chart projection
    let daysToThreshold = null;
    if (!alreadyCrossed && result.slope !== 0 && threshold) {
      const lastIdx = regressionInput.length - 1;
      if (result.slope < 0 && threshold.min !== null) {
        // How many more steps until slope * (lastIdx + steps) + intercept = min?
        const stepsToMin = (threshold.min - result.intercept) / result.slope - lastIdx;
        if (stepsToMin > 0) daysToThreshold = Math.round((stepsToMin / READINGS_PER_DAY) * 10) / 10;
      } else if (result.slope > 0 && threshold.max !== null) {
        const stepsToMax = (threshold.max - result.intercept) / result.slope - lastIdx;
        if (stepsToMax > 0) daysToThreshold = Math.round((stepsToMax / READINGS_PER_DAY) * 10) / 10;
      }
    }

    forecastSensors[sensor.id] = {
      sensor_id: sensor.id,
      sensor_code: sensor.sensor_code,
      name: sensor.name,
      metric_type: sensor.metric_type,
      unit: sensor.unit,
      room_name: sensor.room_name,
      current: currentVal,
      projected_7d: projectedVal,
      trend_dir: trendDir,
      risk,
      already_crossed: alreadyCrossed,
      days_to_threshold: daysToThreshold,
      history_count: regressionInput.length,
      history_start: fullTimestamps[0] || null,
      history_end: fullTimestamps[fullTimestamps.length - 1] || null,
      backtest: backtestForecast(regressionInput, fullTimestamps)
    };

    // Build the chart's projected points using the EXACT SAME slope/intercept
    // that produced projected_7d above — not a separately-fitted regression —
    // so the dashed line on the chart can never contradict the stat boxes.
    // futureIdx is computed relative to the regression input's own length,
    // since that's the index space the fitted slope/intercept belong to.
    let projected = [currentVal, currentVal, currentVal, currentVal];
    if (regressionInput.length > 1) {
      const lastIdx = regressionInput.length - 1;
      projected = [0, 2, 4, 7].map(days => {
        const futureIdx = lastIdx + READINGS_PER_DAY * days;
        return Math.round((result.slope * futureIdx + result.intercept) * 100) / 100;
      });
      projected[0] = currentVal;
    }
    forecastHist[sensor.id] = {
      actual: displayHistory,
      timestamps: (sensorStats[sensor.id].fullTimestamps || []).slice(-displayHistory.length),
      projected
    };
  });

  const forecastDCs = drilldownDCs.map(dc => {
    const allSensors = dc.rooms.flatMap(r => r.sensors.map(s => ({ ...s, room_name: r.name })));
    let worstRisk = 'stable';
    let worstSensorId = allSensors.length ? allSensors[0].id : null;
    allSensors.forEach(s => {
      const f = forecastSensors[s.id];
      if (f.risk === 'high' || (f.risk === 'watch' && worstRisk === 'stable')) {
        worstRisk = f.risk;
        worstSensorId = s.id;
      }
    });
    return {
      id: dc.id,
      name: dc.name,
      client: dc.client,
      location: dc.location,
      overall_risk: worstRisk,
      worst_sensor_id: worstSensorId,
      sensors: allSensors.map(s => forecastSensors[s.id])
    };
  });

  const federated = {
    crm,
    telemetry,
    overview,
    clients: crm.clients,
    data_centers: crm.data_centers,
    rooms: roomsList,
    sensors: crm.sensors,
    alerts,
    drilldown: { data_centers: drilldownDCs, clients: crm.clients },
    compare: { byMetric: compareByMetric, byRoom: compareByRoom, rooms: roomsList },
    forecast: forecastDCs,
    forecast_hist: forecastHist,
  };
  latestTelemetryVersion = telemetryPayloadVersion(payload);
  latestThresholdVersion = JSON.stringify({ global: payload.thresholds || {}, facilities: payload.facility_thresholds || {} });
  return federated;
}

async function renderRefreshedDashboard(data) {
  DATA = data;
  updateAlertNavBadge(DATA);
  dashboardRefreshers.overview?.(DATA);
  dashboardRefreshers.compare?.(DATA);
  dashboardRefreshers.drilldown?.(DATA);
  dashboardRefreshers.forecast?.(DATA);
  await dashboardRefreshers.alerts?.(DATA);
}

async function refreshDashboardFromServer() {
  if (dashboardRefreshInProgress) throw new Error('A dashboard refresh is already in progress. Please save again in a moment.');
  dashboardRefreshInProgress = true;
  try {
    const payload = await requestDashboardPayload();
    const nextData = await fetchAndFederatePipelines(payload);
    await renderRefreshedDashboard(nextData);
  } finally {
    dashboardRefreshInProgress = false;
  }
}

function initDashboardRefresh() {
  window.setInterval(async () => {
    if (dashboardRefreshInProgress) return;
    dashboardRefreshInProgress = true;
    try {
      const payload = await requestDashboardPayload();
      const version = telemetryPayloadVersion(payload);
      const thresholdVersion = JSON.stringify({ global: payload.thresholds || {}, facilities: payload.facility_thresholds || {} });
      if ((version && version !== latestTelemetryVersion) || thresholdVersion !== latestThresholdVersion) {
        const nextData = await fetchAndFederatePipelines(payload);
        await renderRefreshedDashboard(nextData);
      }
    } catch (error) {
      console.error('Dashboard refresh check failed:', error);
    } finally {
      dashboardRefreshInProgress = false;
    }
  }, AUTO_REFRESH_MS);
}

async function boot() {
  const user = await requireAuth();
  if (!user) return;

  try {
    DATA = await fetchAndFederatePipelines();
  } catch (error) {
    console.error('Could not load dashboard data:', error);
    document.querySelector('.main').innerHTML = `
      <section class="page active">
        <h1>Dashboard unavailable</h1>
        <p class="subtitle">${error.message}</p>
        <p class="meta">Confirm that the PulseDC backend is running and that you are signed in.</p>
      </section>`;
    return;
  }

  window.PulseDC.refreshDashboard = refreshDashboardFromServer;
  window.PulseDC.loadThresholdSettings = () => loadThresholdSettings(user);
  initNav();
  updateAlertNavBadge(DATA);
  initTheme();
  initOperatingLimits(user);
  dashboardRefreshers.overview = initOverview(DATA);
  dashboardRefreshers.compare = initCompare(DATA);
  dashboardRefreshers.drilldown = initDrilldown(DATA);
  dashboardRefreshers.forecast = initForecast(DATA);
  dashboardRefreshers.alerts = await initAlerts(DATA);
  initDashboardRefresh();

  // -------------------------------------------------------------
  // EventBus Subscriptions: Decoupled cross-component updates
  // -------------------------------------------------------------
  if (window.PulseDC?.EventBus) {
    window.PulseDC.EventBus.on('alerts:updated', ({ activeCount }) => {
      const badge = document.getElementById('navAlertBadge');
      if (badge) {
        badge.textContent = activeCount;
        badge.hidden = activeCount === 0;
      }
      const ovAlerts = document.getElementById('ovActiveAlerts');
      if (ovAlerts) ovAlerts.textContent = activeCount;
      const ovBox = document.getElementById('ovActiveAlertsBox');
      if (ovBox) ovBox.classList.toggle('danger', activeCount > 0);
    });
  }
}

boot();
