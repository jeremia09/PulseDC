/* ============================================================
   core/simulation-engine.js — Simulation & Fault Scenario Engine
   Generates live telemetry stream ticks for proof-of-concept
   testing without requiring physical IoT sensor hardware.
   Supports real-time fault injection scenarios.
   ============================================================ */

(function (global) {
  'use strict';

  let currentScenario = 'coolant_leak'; // Default POC story scenario
  let isRunning = true;
  let tickListeners = [];
  let scenarioListeners = [];
  let tickIntervalId = null;

  // Base metric defaults per data center
  const SITES = [
    { id: 1, name: 'DC-Alpha', location: 'Kuala Lumpur' },
    { id: 2, name: 'DC-Beta', location: 'Cyberjaya' },
    { id: 3, name: 'DC-Gamma', location: 'Penang' },
    { id: 4, name: 'DC-Delta', location: 'Johor Bahru' },
    { id: 5, name: 'DC-Epsilon', location: 'Kuching' },
    { id: 6, name: 'DC-Zeta', location: 'Kota Kinabalu' }
  ];

  const BASELINES = {
    flow_rate: 40.0,
    temperature: 22.0,
    humidity: 45.0,
    pressure: 100.0
  };

  // Target site & metric for each fault scenario to ensure instant, reliable demo feedback
  const SCENARIO_TARGETS = {
    coolant_leak: { siteName: 'DC-Epsilon', metric: 'flow_rate', room: 'Mechanical Room (B01, Basement)' },
    hvac_failure: { siteName: 'DC-Gamma', metric: 'temperature', room: 'Server Room A (101, Ground Floor)' },
    pressure_drop: { siteName: 'DC-Delta', metric: 'pressure', room: 'Server Room B (201, Level 2)' }
  };

  const DEFAULT_ROOMS = ['Server Room A (101)', 'Server Room B (201)', 'Mechanical Room (B01)', 'Electrical Room (102)'];

  /**
   * Generates a single simulated telemetry tick reading
   */
  function generateTickReading(site, metricType, stepOffset = 0) {
    let base = BASELINES[metricType];
    let noise = (Math.random() - 0.5) * 1.5;
    let value = base + noise;
    let roomName = DEFAULT_ROOMS[Math.floor(Math.random() * DEFAULT_ROOMS.length)];

    // Apply fault scenario rules
    const target = SCENARIO_TARGETS[currentScenario];
    if (target && site.name === target.siteName && metricType === target.metric) {
      roomName = target.room;
      if (currentScenario === 'coolant_leak') value = 21.0 - (Math.random() * 3.5);
      else if (currentScenario === 'hvac_failure') value = 28.5 + (Math.random() * 3.0);
      else if (currentScenario === 'pressure_drop') value = 84.0 - (Math.random() * 3.0);
    }

    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const status = global.ThresholdEngine
      ? global.ThresholdEngine.evaluateMetricStatus(metricType, value)
      : 'ok';

    return {
      data_center_id: site.id,
      dc_name: site.name,
      room_name: roomName,
      location: site.location,
      metric_type: metricType,
      value: Math.round(value * 100) / 100,
      timestamp,
      is_alert: status !== 'ok',
      severity: status
    };
  }

  function emitTick(site, metric) {
    const reading = generateTickReading(site, metric);
    tickListeners.forEach(cb => cb(reading));
  }

  function setScenario(scenarioKey) {
    currentScenario = scenarioKey;
    console.log(`[SimulationEngine] Scenario updated to: ${scenarioKey}`);
    scenarioListeners.forEach(cb => cb(scenarioKey));

    // Instantly emit a tick for the active scenario target so UI reflects changes immediately
    const target = SCENARIO_TARGETS[scenarioKey];
    if (target && isRunning) {
      const site = SITES.find(s => s.name === target.siteName);
      if (site) {
        emitTick(site, target.metric);
      }
    }
  }

  function getScenario() {
    return currentScenario;
  }

  function onTick(callback) {
    tickListeners.push(callback);
  }

  function onScenarioChange(callback) {
    scenarioListeners.push(callback);
  }

  function start(intervalMs = 2500) {
    if (tickIntervalId) clearInterval(tickIntervalId);
    isRunning = true;

    tickIntervalId = setInterval(() => {
      if (!isRunning) return;

      const target = SCENARIO_TARGETS[currentScenario];
      // 65% of ticks are biased toward the active scenario target so faults manifest quickly during demos
      if (target && Math.random() < 0.65) {
        const site = SITES.find(s => s.name === target.siteName);
        if (site) {
          emitTick(site, target.metric);
          return;
        }
      }

      // Remaining ticks sample randomly across all sites/metrics
      const site = SITES[Math.floor(Math.random() * SITES.length)];
      const metrics = ['flow_rate', 'temperature', 'humidity', 'pressure'];
      const metric = metrics[Math.floor(Math.random() * metrics.length)];

      emitTick(site, metric);
    }, intervalMs);
  }

  function pause() {
    isRunning = false;
  }

  function resume() {
    isRunning = true;
  }

  function togglePause() {
    isRunning = !isRunning;
    return isRunning;
  }

  const SimulationEngine = {
    SITES,
    BASELINES,
    generateTickReading,
    setScenario,
    getScenario,
    onTick,
    onScenarioChange,
    start,
    pause,
    resume,
    togglePause
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimulationEngine;
  } else {
    global.SimulationEngine = SimulationEngine;
  }
})(typeof window !== 'undefined' ? window : this);
