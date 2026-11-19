/* ============================================================
   core/thresholds.js — Channel-Free Threshold & Metric Logic
   Evaluates metric boundaries and severity independent of UI rendering.
   ============================================================ */

(function (global) {
  'use strict';

  const METRIC_TYPES = ['flow_rate', 'temperature', 'humidity', 'pressure'];
  const THRESHOLDS = {};
  const FACILITY_THRESHOLDS = {};

  function setThresholds(serverThresholds) {
    if (!serverThresholds || typeof serverThresholds !== 'object') return false;
    for (const metricType of METRIC_TYPES) {
      const rule = serverThresholds[metricType];
      if (!rule) return false;
      THRESHOLDS[metricType] = {
        min: rule.min == null ? null : Number(rule.min),
        max: rule.max == null ? null : Number(rule.max),
        warningMargin: Number(rule.warning_margin ?? rule.warningMargin),
        unit: rule.unit || ''
      };
    }
    return true;
  }

  function setFacilityThresholds(serverOverrides, { replace = true } = {}) {
    if (replace) Object.keys(FACILITY_THRESHOLDS).forEach(id => delete FACILITY_THRESHOLDS[id]);
    if (!serverOverrides || typeof serverOverrides !== 'object') return false;
    Object.entries(serverOverrides).forEach(([id, item]) => {
      FACILITY_THRESHOLDS[id] = {};
      Object.entries(item?.thresholds || {}).forEach(([metricType, rule]) => {
        FACILITY_THRESHOLDS[id][metricType] = {
          min: rule.min == null ? null : Number(rule.min),
          max: rule.max == null ? null : Number(rule.max),
          warningMargin: Number(rule.warning_margin ?? rule.warningMargin),
          unit: rule.unit || ''
        };
      });
    });
    return true;
  }

  function getRule(metricType, dataCenterId = null) {
    const facilityRule = dataCenterId == null ? null : FACILITY_THRESHOLDS[dataCenterId]?.[metricType];
    return facilityRule || THRESHOLDS[metricType] || null;
  }

  /**
   * Evaluates a single value against threshold definitions.
   * @returns {'ok' | 'warning' | 'critical'}
   */
  function evaluateMetricStatus(metricType, value, dataCenterId = null) {
    const rule = getRule(metricType, dataCenterId);
    if (!rule) return 'ok';

    // Critical check
    if (rule.min !== null && value < rule.min) return 'critical';
    if (rule.max !== null && value > rule.max) return 'critical';

    // Warning check (nearing limits)
    if (rule.min !== null && value < (rule.min + rule.warningMargin)) return 'warning';
    if (rule.max !== null && value > (rule.max - rule.warningMargin)) return 'warning';

    return 'ok';
  }

  /**
   * Generates a standardized alert payload for channel dispatching (Dashboard, Webhook, SMS, etc.)
   */
  function createAlertEvent(siteName, metricType, value, timestamp, statusOverride = null, dataCenterId = null) {
    const status = statusOverride || evaluateMetricStatus(metricType, value, dataCenterId);
    const rule = getRule(metricType, dataCenterId);

    let message = `${siteName} ${metricType} is ${value} ${rule ? rule.unit : ''}`;
    if (status === 'critical') {
      message = `CRITICAL: ${siteName} ${metricType} breached safety threshold (${value} ${rule ? rule.unit : ''})`;
    } else if (status === 'warning') {
      message = `WARNING: ${siteName} ${metricType} approaching limit (${value} ${rule ? rule.unit : ''})`;
    }

    return {
      id: 'alt_' + Math.random().toString(36).substr(2, 9),
      siteName,
      metricType,
      value,
      timestamp,
      severity: status,
      message
    };
  }

  // Export module for browser global or CommonJS/ESM
  const ThresholdEngine = {
    THRESHOLDS,
    FACILITY_THRESHOLDS,
    setThresholds,
    setFacilityThresholds,
    getRule,
    evaluateMetricStatus,
    createAlertEvent
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThresholdEngine;
  } else {
    global.ThresholdEngine = ThresholdEngine;
  }
})(typeof window !== 'undefined' ? window : this);
