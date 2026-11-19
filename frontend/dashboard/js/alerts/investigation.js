/* Alert investigation UI, cache, and automatic investigation lifecycle. */
window.PulseDC.AlertInvestigation = {
  create({ feed, inbox, detail, alerts: initialAlerts, onStateChange, onNavigate }) {
    const { escapeHtml, formatTimestamp } = window.PulseDC.Utils;
    const automaticAttempts = new Set();
    const automaticPending = new Set();
    const initialAlertIds = new Set(initialAlerts.map(alert => String(alert.id)));
    const INVESTIGATION_API_BASE = window.PulseDC.API.getBaseUrl();
    const investigationCache = {};
    const investigationErrors = {};
    const inFlight = {};
    const activeTabByAlert = {};
    let alertsById = new Map(initialAlerts.map(alert => [String(alert.id), alert]));
    let selectedAlertId = null;

    function renderInbox(alerts) {
      alertsById = new Map(alerts.map(alert => [String(alert.id), alert]));
      const visibleAlerts = alerts.slice(0, 30);
      const selected = alertsById.get(String(selectedAlertId));
      inbox.innerHTML = visibleAlerts.length ? visibleAlerts.map(alert => {
        const state = alert.alertState || {};
        const isResolved = (alert.displayedSeverity || alert.severity) === 'resolved';
        let inboxStage = '<span class="alert-stage-pill stage-new">New</span>';
        if (isResolved) inboxStage = '<span class="alert-stage-pill stage-resolved">Resolved</span>';
        else if (state.acknowledged) inboxStage = '<span class="alert-stage-pill stage-ack">Claimed</span>';

        return `
        <button class="investigation-inbox-item ${String(alert.id) === selectedAlertId ? 'selected' : ''}"
          type="button" data-investigation-select="${alert.id}" aria-current="${String(alert.id) === selectedAlertId ? 'true' : 'false'}">
          <div style="display:flex;align-items:center;gap:4px">
            <span class="sev-badge ${escapeHtml(alert.displayedSeverity || alert.severity)}">${escapeHtml((alert.displayedSeverity || alert.severity)[0].toUpperCase() + (alert.displayedSeverity || alert.severity).slice(1))}</span>
            ${inboxStage}
          </div>
          <strong>${escapeHtml(alert.dc_name)} · Room ${escapeHtml(alert.room_code)}</strong>
          <span>${escapeHtml(alert.description)}</span>
          <small>${escapeHtml(alert.sensor_code)} · ${state.acknowledged ? `Claimed by ${escapeHtml(state.acknowledged_by || 'Operator')} · ` : ''}${escapeHtml(formatTimestamp(alert.timestamp))}</small>
        </button>`;
      }).join('')
        : '<p class="investigation-inbox-empty">There are no alerts to review.</p>';
    }

    function renderSelectedAlert() {
      const alert = alertsById.get(String(selectedAlertId));
      if (!alert) {
        detail.innerHTML = `<div class="investigation-empty-state">
          <span class="investigation-empty-icon" aria-hidden="true"><i class="fi fi-rr-check"></i></span>
          <h2>Choose an alert to review</h2>
          <p>Select an alert from this list or choose <strong>Review alert</strong> from the Alerts page.</p>
        </div>`;
        return;
      }

      const id = String(alert.id);
      const sev = alert.displayedSeverity || alert.severity;
      const state = alert.alertState || {};
      
      let lifecycleBadge = '<span class="alert-stage-pill stage-new">● New Incident</span>';
      if (sev === 'resolved') {
        lifecycleBadge = '<span class="alert-stage-pill stage-resolved"><i class="fi fi-rr-check" aria-hidden="true"></i> Resolved</span>';
      } else if (state.acknowledged) {
        lifecycleBadge = `<span class="alert-stage-pill stage-ack"><i class="fi fi-rr-eye" aria-hidden="true"></i> Acknowledged${state.acknowledged_by ? ` by ${escapeHtml(state.acknowledged_by)}` : ''}</span>`;
      }

      detail.innerHTML = `<div class="investigation-selected-alert">
        <div class="investigation-top-nav-bar">
          <button type="button" class="btn-return" data-investigation-back>
            <i class="fi fi-rr-arrow-left"></i> Back to Alerts
          </button>
          <button type="button" class="btn-inspect-facility" id="investigationJumpSiteBtn"
            data-site-id="${escapeHtml(alert.data_center_id || '')}"
            data-room-id="${escapeHtml(alert.room_id || '')}"
            data-sensor-id="${escapeHtml(alert.sensor_id || '')}">
            <i class="fi fi-rr-search"></i> Inspect in Site Explorer
          </button>
        </div>
        <div class="investigation-selected-heading">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="sev-badge ${escapeHtml(sev)}">${escapeHtml(sev[0].toUpperCase() + sev.slice(1))}</span>
            ${lifecycleBadge}
          </div>
          <span>${escapeHtml(formatTimestamp(alert.timestamp))}</span>
        </div>
        <h2>${escapeHtml(alert.dc_name)} · Room ${escapeHtml(alert.room_code)} — ${escapeHtml(alert.description)}</h2>
        <p class="investigation-selected-meta">${escapeHtml(alert.sensor_code)} · ${escapeHtml(alert.location)} · Reading: <strong>${escapeHtml(alert.value)} ${escapeHtml(alert.unit)}</strong></p>
        <div id="investigationReport" class="investigation-report"></div>
      </div>`;

      // Wire up direct jump to Site Explorer
      const jumpSiteBtn = detail.querySelector('#investigationJumpSiteBtn');
      if (jumpSiteBtn) {
        jumpSiteBtn.addEventListener('click', () => {
          if (window.gotoDrilldown) {
            window.gotoDrilldown(alert.client_id, alert.data_center_id, alert.room_id, alert.sensor_id, {
              page: 'investigations',
              label: 'Assisted Fixes',
              alertTitle: `${alert.dc_name} Room ${alert.room_code}`
            });
          }
        });
      }

      const report = detail.querySelector('#investigationReport');
      if (investigationCache[id]) {
        renderInvestigationPanel(report, investigationCache[id], alert);
      } else if (investigationErrors[id]) {
        renderInvestigationPanel(report, { error: investigationErrors[id] }, alert);
      } else if (inFlight[id]) {
        report.innerHTML = '<p role="status" class="investigation-loading"><i class="fi fi-rr-spinner"></i> Reviewing the alert evidence…</p>';
      } else {
        report.innerHTML = '<p role="status" class="investigation-loading"><i class="fi fi-rr-spinner"></i> Preparing the review…</p>';
      }
    }

    async function requestReport(alert, source) {
      const id = String(alert.id);
      if (investigationCache[id]) return investigationCache[id];
      if (inFlight[id]) return inFlight[id];
      const task = (async () => {
        try {
          const response = await fetch(`${INVESTIGATION_API_BASE}/api/alerts/investigate/${encodeURIComponent(id)}`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(source === 'automatic' ? { source } : {})
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || `Investigation failed (${response.status}).`);
          investigationCache[id] = result;
          delete investigationErrors[id];
          return result;
        } catch (error) {
          investigationErrors[id] = error.message || 'network error';
          throw error;
        } finally {
          delete inFlight[id];
          automaticPending.delete(id);
          onStateChange();
          if (selectedAlertId === id) renderSelectedAlert();
        }
      })();
      inFlight[id] = task;
      return task;
    }

    async function openAlert(alert) {
      selectedAlertId = String(alert.id);
      delete investigationErrors[selectedAlertId];
      renderInbox([...alertsById.values()]);
      onNavigate('investigations');
      renderSelectedAlert();
      try {
        await requestReport(alert, automaticAttempts.has(String(alert.id)) ? 'automatic' : 'manual');
      } catch (error) {
        if (selectedAlertId === String(alert.id)) {
          const report = detail.querySelector('#investigationReport');
          if (report) renderInvestigationPanel(report, { error: error.message || 'network error' }, alert);
        }
      }
    }

    async function investigateAutomatically(alert) {
      const id = String(alert.id);
      if (automaticAttempts.has(id)) return;
      automaticAttempts.add(id);
      automaticPending.add(id);
      onStateChange();
      try {
        await requestReport(alert, 'automatic');
      } catch (error) {
        console.error(`Automatic investigation failed for alert ${id}:`, error);
      }
    }

    const FEATURE_LABELS = {
      value: 'Current reading',
      rolling_mean_6: 'Recent average',
      rolling_std_6: 'Recent instability',
      delta_prev: 'Change since last reading',
      hour_of_day: 'Time of day',
      metric_type_TEMP: 'Sensor type: Temperature',
      metric_type_HUM: 'Sensor type: Humidity',
      metric_type_PRESSURE: 'Sensor type: Pressure',
      metric_type_FLOW: 'Sensor type: Flow rate',
      metric_type_UNKNOWN: 'Sensor type: Unknown'
    };
    const FEATURE_INFO = {
      value: 'The sensor reading at the moment it was recorded.',
      rolling_mean_6: 'The average of this sensor\'s last 6 readings. Shows the recent trend rather than a single moment.',
      rolling_std_6: 'How much the last 6 readings jumped around. High = unstable, low = steady.',
      delta_prev: 'How much the reading changed compared with the one right before it.',
      hour_of_day: 'The hour of day (0-23) when the reading was taken.',
      metric_type_TEMP: 'Whether this is a temperature sensor. The model treats each sensor type differently.',
      metric_type_HUM: 'Whether this is a humidity sensor. The model treats each sensor type differently.',
      metric_type_PRESSURE: 'Whether this is a pressure sensor. The model treats each sensor type differently.',
      metric_type_FLOW: 'Whether this is a coolant flow sensor. The model treats each sensor type differently.',
      metric_type_UNKNOWN: 'The sensor type could not be identified from its code.'
    };
    function friendlyFeatureName(raw) { return FEATURE_LABELS[raw] || raw; }

    function renderInvestigationPanel(panel, data, activeAlert) {
      if (data.error) {
        panel.innerHTML = `<p class="investigation-error" role="alert">
          Couldn't complete the investigation: ${escapeHtml(data.error)}
        </p>`;
        return;
      }

      const alert = activeAlert || alertsById.get(String(selectedAlertId)) || {};
      const threshold = data.threshold_check || {};
      const history = data.history || {};
      const model = data.model || {};
      const checks = (data.recommended_checks || []);
      const firstCheck = checks[0] || 'Inspect physical sensor connection and room cooling valve.';

      /* ---------------- 1. Operator-First Summary Grid (What, Where, Urgency, First Check) ---------------- */
      const sev = alert.displayedSeverity || alert.severity || 'warning';
      const urgencyLabel = sev === 'critical'
        ? '<i class="fi fi-rr-triangle-warning" aria-hidden="true"></i> Urgent (Immediate action required)'
        : '<i class="fi fi-rr-info" aria-hidden="true"></i> Moderate (Inspect promptly)';
      const whatHappened = data.summary || `${alert.description || 'Abnormal sensor variance'} recorded on ${alert.sensor_code || 'sensor'}.`;
      const locationWhere = `${alert.dc_name || 'Site'} — Room ${alert.room_code || ''} (${alert.room_name || 'Server Room'}) · ${alert.location || ''}`;

      const plainLanguageSummaryCard = `
        <div class="investigation-executive-card">
          <div class="exec-card-title">
            <span class="exec-badge"><i class="fi fi-rr-document-signed"></i> Incident Overview</span>
            <span class="exec-meta">Operational Summary</span>
          </div>
          <div class="exec-summary-grid">
            <div class="exec-grid-item">
              <span class="exec-label"><i class="fi fi-rr-triangle-warning" aria-hidden="true"></i> Detected Issue</span>
              <p class="exec-val">${escapeHtml(whatHappened)}</p>
            </div>
            <div class="exec-grid-item">
              <span class="exec-label"><i class="fi fi-rr-marker" aria-hidden="true"></i> Location</span>
              <p class="exec-val">${escapeHtml(locationWhere)}</p>
            </div>
            <div class="exec-grid-item">
              <span class="exec-label"><i class="fi fi-rr-bell" aria-hidden="true"></i> Urgency</span>
              <p class="exec-val"><strong>${urgencyLabel}</strong></p>
            </div>
            <div class="exec-grid-item highlight">
              <span class="exec-label"><i class="fi fi-rr-search" aria-hidden="true"></i> Initial Recommended Check</span>
              <p class="exec-val"><strong>${escapeHtml(firstCheck)}</strong></p>
            </div>
          </div>
        </div>
      `;

      /* ---------------- 2. Evidence agreement and availability ---------------- */
      const thresholdAvailable = threshold.available !== false
        && ['critical', 'warning', 'ok'].includes(threshold.status);
      const thresholdFlags = threshold.status === 'critical' || threshold.status === 'warning';
      const modelDecision = String(model.prediction || '').toLowerCase();
      const modelAvailable = model.available === true
        && ['anomalous', 'anomaly', 'normal'].includes(modelDecision);
      const modelFlags = ['anomalous', 'anomaly'].includes(modelDecision);
      const hasHistory = history.available === true && Number(history.window_readings) >= 4;
      const hasModel = modelAvailable;
      const evidenceCanBeCompared = thresholdAvailable && modelAvailable;
      const evidenceAgrees = evidenceCanBeCompared && thresholdFlags === modelFlags;

      let evidenceLabel = 'Limited evidence';
      let evidencePillClass = 'conf-med';
      let evidenceDetail = 'A threshold result or model decision is unavailable, so the signals cannot be compared. Treat this assessment as preliminary.';

      if (evidenceCanBeCompared && !evidenceAgrees) {
        evidenceLabel = 'Signals differ';
        evidencePillClass = 'conf-low';
        evidenceDetail = `The threshold ${thresholdFlags ? 'flags this reading' : 'is within its configured range'}, while the model classifies it as ${modelFlags ? 'anomalous' : 'normal'}. These checks use different evidence; review the reading and recent trend before deciding what to do.`;
      } else if (evidenceAgrees && !hasHistory) {
        evidenceLabel = 'Signals align · limited history';
        evidencePillClass = 'conf-med';
        evidenceDetail = `The threshold and model both ${thresholdFlags ? 'flag this reading' : 'assess it as normal'}, but there are fewer than four recent readings to establish context.`;
      } else if (evidenceAgrees) {
        evidenceLabel = 'Signals align';
        evidencePillClass = 'conf-high';
        evidenceDetail = `The threshold and model both ${thresholdFlags ? 'flag this reading' : 'assess it as normal'}, and recent sensor history is available. This agreement is supporting evidence, not proof of a physical cause.`;
      }

      const evaluationTimestamp = data.created_at || data.recent_investigations?.[0]?.created_at;
      const evaluationTimeLabel = evaluationTimestamp
        ? formatTimestamp(evaluationTimestamp) || 'Time unavailable'
        : 'Time unavailable';

      const evidenceUncertaintyBanner = `
        <div class="evidence-uncertainty-banner">
          <div class="evidence-header-row">
            <div>
              <span class="explain-section-label">Evidence Assessment</span>
              <div class="evidence-title">Threshold and model: <span class="confidence-pill ${evidencePillClass}">${evidenceLabel}</span></div>
            </div>
            <span class="evidence-timestamp"><i class="fi fi-rr-time-check"></i> Evaluated ${escapeHtml(evaluationTimeLabel)}</span>
          </div>
          <p class="evidence-detail-text">${escapeHtml(evidenceDetail)}</p>
          <div class="evidence-checklist">
            <div class="evidence-check-chip ${thresholdAvailable ? (thresholdFlags ? 'chip-missing' : 'chip-pass') : 'chip-missing'}">
              <i class="fi ${thresholdAvailable && !thresholdFlags ? 'fi-rr-check' : 'fi-rr-triangle-warning'}" aria-hidden="true"></i> Threshold: ${escapeHtml(threshold.message || (thresholdAvailable ? (thresholdFlags ? 'Configured limit exceeded' : 'Within configured range') : 'Threshold result unavailable'))}
            </div>
            <div class="evidence-check-chip ${hasHistory ? 'chip-pass' : 'chip-missing'}">
              <i class="fi ${hasHistory ? 'fi-rr-check' : 'fi-rr-triangle-warning'}" aria-hidden="true"></i> Historical Context: ${history.available ? `${history.window_readings} past readings verified` : 'Missing recent readings'}
            </div>
            <div class="evidence-check-chip ${hasModel ? 'chip-pass' : 'chip-missing'}">
              <i class="fi ${hasModel ? 'fi-rr-check' : 'fi-rr-triangle-warning'}" aria-hidden="true"></i> Model result: ${hasModel ? `${modelFlags ? 'Anomalous' : 'Normal'} · ${Math.round(Number(model.anomaly_probability) * 100)}% anomaly risk` : 'Pattern check unavailable'}
            </div>
          </div>
        </div>
      `;

      /* ---------------- 3. Actionable Checklist ---------------- */
      const remainingChecks = checks.slice(1);
      const checksHtml = checks.length ? `
        <section class="investigation-checks">
          <span class="explain-section-label">Inspection & Verification Steps</span>
          <ol class="operator-checklist">
            ${checks.map((check, idx) => `
              <li>
                <span class="check-step-num">${idx + 1}</span>
                <span class="check-step-text">${escapeHtml(check)}</span>
              </li>
            `).join('')}
          </ol>
          <p class="investigation-checks-note">Follow standard on-site facility health and safety protocols while performing these inspections.</p>
        </section>
      ` : '';

      /* ---------------- 4. Activity History & Audit Trail ---------------- */
      const pastRuns = (data.recent_investigations || []).map(run => {
        const runEvidence = run.evidence || {};
        const runThreshold = runEvidence.threshold_check || {};
        const operatorActions = run.operator_actions || [];
        const actionsMarkup = operatorActions.length ? `
          <div class="audit-action-badges">
            ${operatorActions.map(act => `
              <span class="audit-action-tag"><i class="fi fi-rr-user"></i> <strong>${escapeHtml(act.label || act.action)}</strong> by ${escapeHtml(act.acted_by)} (${escapeHtml(act.acted_at)})</span>
            `).join('')}
          </div>
        ` : `<span class="investigation-history-action">${escapeHtml(run.operator_action || 'No action recorded yet')}</span>`;

        return `
          <li class="investigation-history-item">
            <div class="history-item-head">
              <strong>${escapeHtml(formatTimestamp(run.created_at))}</strong>
              <span>${escapeHtml(run.agent_status === 'ai-assisted' ? 'AI-assisted diagnosis' : 'Automated sensor check')} · ${escapeHtml(run.requested_by || 'Operator')}</span>
            </div>
            <p class="history-item-summary">${escapeHtml(run.summary)}</p>
            ${actionsMarkup}
            <details class="history-details-accordion">
              <summary>View evidence snapshot available at time of review</summary>
              <div class="history-details-body">
                <p><strong>Limit check:</strong> ${escapeHtml(runThreshold.message || 'Safe limits evaluated')}</p>
                ${run.recommended_checks ? `<strong>Checks advised:</strong><ul>${run.recommended_checks.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
              </div>
            </details>
          </li>`;
      }).join('');

      /* ---------------- 5. Technical Details (Secondary) ---------------- */
      const features = [...(data.model?.top_signals || [])]
        .sort((a, b) => Math.abs(b.shap_contribution) - Math.abs(a.shap_contribution));
      const maxAbs = Math.max(...features.map(f => Math.abs(f.shap_contribution)), 0.0001);
      const factorRows = features.map((f, index) => {
        const pct = Math.round((Math.abs(f.shap_contribution) / maxAbs) * 100);
        const positive = f.shap_contribution >= 0;
        const tip = FEATURE_INFO[f.feature] || '';
        return `
          <li class="explain-factor ${positive ? 'alert-signal' : 'normal-signal'}" title="${escapeHtml(tip)}">
            <span class="explain-factor-rank">${index + 1}</span>
            <span class="explain-factor-name">${escapeHtml(friendlyFeatureName(f.feature))}</span>
            <span class="explain-factor-direction">${positive ? 'Abnormal influence' : 'Normal influence'}</span>
            <span class="explain-factor-track" aria-hidden="true"><span style="width:${pct}%"></span></span>
            <span class="explain-factor-value">${positive ? '+' : ''}${f.shap_contribution.toFixed(3)}</span>
          </li>`;
      }).join('');

      const trail = (data.investigation_steps || []).map(step => `<li>${escapeHtml(step)}</li>`).join('');

      const alertId = String(data.alert?.reading_id || selectedAlertId || 'current');
      const activeTab = activeTabByAlert[alertId] || 'why';
      const tabContent = {
        why: evidenceUncertaintyBanner,
        technical: `<div class="investigation-tab-section">
          ${features.length ? `
            <span class="explain-section-label">Diagnostic Telemetry Weights</span>
            <p class="explain-scale-note">These weights show which specific readings most strongly triggered the anomaly model. They help engineers fine-tune thresholds.</p>
            <ol class="explain-factor-list">${factorRows}</ol>
          ` : '<p class="investigation-empty-state-copy">Detailed sensor model signals are not available for this alert.</p>'}
          ${trail ? `<div class="investigation-trail"><span class="explain-section-label">Diagnostic Steps PulseDC Took</span><ol>${trail}</ol></div>` : ''}
        </div>`,
        history: pastRuns.length
          ? `<ol class="investigation-history-list">${pastRuns}</ol>`
          : '<p class="investigation-empty-state-copy">No earlier investigation or operator action has been recorded for this alert.</p>'
      };

      const tabs = [
        ['why', 'Certainty & Evidence'],
        ['technical', 'Sensor Telemetry Weights (Advanced)'],
        ['history', `Action & Audit History${data.recent_investigations?.length ? ` (${data.recent_investigations.length})` : ''}`]
      ];

      panel.innerHTML = `
        <div class="explain-content investigation-content">
          ${plainLanguageSummaryCard}
          ${checksHtml}
          <div class="investigation-tabs" role="tablist" aria-label="Investigation information">
            ${tabs.map(([key, label]) => `<button type="button" role="tab" id="investigation-tab-${alertId}-${key}"
              aria-controls="investigation-panel-${alertId}" aria-selected="${activeTab === key}" tabindex="${activeTab === key ? '0' : '-1'}"
              data-investigation-tab="${key}">${label}</button>`).join('')}
          </div>
          <div class="investigation-tab-content" id="investigation-panel-${alertId}" role="tabpanel"
            aria-labelledby="investigation-tab-${alertId}-${activeTab}" tabindex="0">
            ${tabContent[activeTab] || tabContent.why}
          </div>
        </div>`;
    }

    feed.addEventListener('click', event => {
      const button = event.target.closest('[data-review-id]');
      if (!button) return;
      const alert = alertsById.get(String(button.dataset.reviewId));
      if (alert) void openAlert(alert);
    });

    inbox.addEventListener('click', event => {
      const button = event.target.closest('[data-investigation-select]');
      if (!button) return;
      const alert = alertsById.get(String(button.dataset.investigationSelect));
      if (alert) void openAlert(alert);
    });

    function selectTab(tabName, moveFocus = false) {
      const id = String(selectedAlertId);
      const data = investigationCache[id];
      if (!data) return;
      activeTabByAlert[id] = tabName;
      const report = detail.querySelector('#investigationReport');
      if (!report) return;
      renderInvestigationPanel(report, data);
      if (moveFocus) report.querySelector(`[data-investigation-tab="${tabName}"]`)?.focus();
    }

    detail.addEventListener('click', event => {
      if (event.target.closest('[data-investigation-back]')) {
        onNavigate('alerts');
        return;
      }
      const tab = event.target.closest('[data-investigation-tab]');
      if (tab) selectTab(tab.dataset.investigationTab, true);
    });

    detail.addEventListener('keydown', event => {
      const currentTab = event.target.closest('[data-investigation-tab]');
      if (!currentTab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...detail.querySelectorAll('[data-investigation-tab]')];
      const currentIndex = tabs.indexOf(currentTab);
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      selectTab(tabs[nextIndex].dataset.investigationTab, true);
    });

    function buttonMarkup(alertId) {
      const id = String(alertId);
      const label = investigationCache[id] ? 'Review report'
        : automaticPending.has(id) ? 'Review in progress' : 'Review alert';
      return `<button class="alert-action secondary" type="button" data-review-id="${id}">${label}</button>`;
    }

    function investigateNew(alerts) {
      const unseenAlerts = alerts.filter(alert => !initialAlertIds.has(String(alert.id)));
      if (!unseenAlerts.length) return;
      void (async () => {
        for (const alert of unseenAlerts) await investigateAutomatically(alert);
      })();
    }

    function setAlerts(alerts, refreshSelected = true) {
      renderInbox(alerts);
      if (selectedAlertId && refreshSelected) renderSelectedAlert();
    }

    renderInbox(initialAlerts);

    return {
      buttonMarkup,
      getReport(readingId) { return investigationCache[String(readingId)]; },
      investigateNew,
      setAlerts
    };
  }
};
