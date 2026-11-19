/* ============================================================
   core/forecast-engine.js — Channel-Free Forecasting & Risk Engine
   Calculates linear trend slopes, project future metric values,
   and computes datacenter risk scores independently of the view layer.
   ============================================================ */

(function (global) {
  'use strict';

  /**
   * Computes simple linear regression (y = slope * x + intercept)
   * @param {Array<{x: number, y: number}>} points
   */
  function calculateLinearRegression(points) {
    const n = points.length;
    if (n < 2) return { slope: 0, intercept: points[0] ? points[0].y : 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += points[i].x;
      sumY += points[i].y;
      sumXY += points[i].x * points[i].y;
      sumXX += points[i].x * points[i].x;
    }

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return { slope: 0, intercept: sumY / n };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  /**
   * Extrapolates future telemetry points and calculates risk level
   * @param {Array<number>} values - Chronological metric history
   * @param {string} metricType - 'temperature', 'humidity', 'pressure', 'flow_rate'
   * @param {number} forecastSteps - Number of steps ahead to predict
   */
  function forecastMetricTrend(values, metricType, forecastSteps = 24, dataCenterId = null) {
    if (!values || values.length === 0) {
      return { trendPoints: [], slope: 0, predictedValue: 0, riskScore: 0, status: 'low' };
    }

    const points = values.map((val, idx) => ({ x: idx, y: val }));
    const { slope, intercept } = calculateLinearRegression(points);

    const lastIdx = values.length - 1;
    const predictedValue = slope * (lastIdx + forecastSteps) + intercept;

    // Evaluate risk score based on how far the projected value has drifted
    // toward or past its safety threshold — expressed as 0-100.
    // Using proportion of the safe-range width so each metric is judged
    // on its own scale instead of raw unit deltas.
    let riskScore = 0; // 0 to 100
    const rule = global.ThresholdEngine ? global.ThresholdEngine.getRule(metricType, dataCenterId) : null;
    const currentVal = values[lastIdx];

    if (rule) {
      // Helper: safe range width for proportional scoring
      const safeWidth = (rule.max !== null && rule.min !== null)
        ? (rule.max - rule.min)
        : (rule.max !== null ? rule.max * 0.5 : rule.min * 0.5);

      // --- Falling toward minimum (e.g. flow_rate dropping) ---
      if (rule.min !== null && slope < 0) {
        const distToThreshold = predictedValue - rule.min;  // negative = already past
        if (distToThreshold <= 0) {
          // Projected to breach — severity by how far past
          riskScore = Math.min(98, 75 + Math.round(Math.abs(distToThreshold) / safeWidth * 80));
        } else {
          // Within bounds but heading toward min — score by proximity
          const warningZone = safeWidth * 0.30; // inner 30% of range = watch zone
          if (distToThreshold < warningZone) {
            riskScore = Math.round((1 - distToThreshold / warningZone) * 60);
          }
          // else: safely far from the boundary — riskScore stays 0
        }
      }

      // --- Rising toward maximum (e.g. temperature rising) ---
      if (rule.max !== null && slope > 0) {
        const distToThreshold = rule.max - predictedValue;  // negative = already past
        if (distToThreshold <= 0) {
          riskScore = Math.min(98, 75 + Math.round(Math.abs(distToThreshold) / safeWidth * 80));
        } else {
          const warningZone = safeWidth * 0.30;
          if (distToThreshold < warningZone) {
            riskScore = Math.round((1 - distToThreshold / warningZone) * 60);
          }
        }
      }
    }

    // Three-tier classification with clear thresholds
    let riskLevel = 'low';
    if (riskScore >= 65) riskLevel = 'high';
    else if (riskScore >= 30) riskLevel = 'medium';

    return {
      slope,
      intercept,
      predictedValue: Math.round(predictedValue * 100) / 100,
      riskScore,
      riskLevel
    };
  }

  const ForecastEngine = {
    calculateLinearRegression,
    forecastMetricTrend
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ForecastEngine;
  } else {
    global.ForecastEngine = ForecastEngine;
  }
})(typeof window !== 'undefined' ? window : this);
