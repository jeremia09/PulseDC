/* ============================================================
   core/utils.js — Shared PulseDC Core Utilities & API Config
   Consolidated helpers for API resolution, HTML escaping,
   formatting, and CSS token access across all view modules.
   ============================================================ */

(function (global) {
  'use strict';

  const PulseDC = global.PulseDC || {};

  // -------------------------------------------------------------
  // API Configuration & Base URL Resolver
  // -------------------------------------------------------------
  const API = {
    /**
     * Resolves the backend API base URL.
     * Matches the current hostname (localhost vs 127.0.0.1) to preserve cookies,
     * or respects window.PULSE_DC_API_BASE if explicitly set.
     */
    getBaseUrl() {
      if (global.PULSE_DC_API_BASE) {
        return global.PULSE_DC_API_BASE;
      }
      const host = (typeof window !== 'undefined' && window.location.hostname === 'localhost')
        ? 'localhost'
        : '127.0.0.1';
      return `http://${host}:5001`;
    }
  };

  // -------------------------------------------------------------
  // General Utility Functions
  // -------------------------------------------------------------
  const Utils = {
    /**
     * Safely escapes untrusted strings for HTML insertion.
     */
    escapeHtml(value) {
      return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[char]));
    },

    /**
     * Formats an ISO-like timestamp string to a human-readable format.
     */
    formatTimestamp(ts, options = {}) {
      if (!ts) return '';
      const date = new Date(String(ts).replace(' ', 'T'));
      const defaultOptions = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      };
      return date.toLocaleString('en-US', Object.assign(defaultOptions, options));
    },

    /**
     * Formats relative time compared to a reference date.
     */
    timeAgo(ts, referenceDate = null) {
      if (!ts) return '';
      const targetDate = new Date(String(ts).replace(' ', 'T'));
      const ref = referenceDate instanceof Date ? referenceDate : new Date();
      const diffMs = Math.max(0, ref - targetDate);
      const hrs = Math.floor(diffMs / 3600000);

      if (hrs < 1) return 'latest simulated event';
      if (hrs < 24) return `${hrs}h ago (simulated)`;
      return `${Math.floor(hrs / 24)}d ago (simulated)`;
    },

    /**
     * Retrieves the computed value of a CSS custom property from :root.
     */
    cssVar(name) {
      if (typeof window === 'undefined') return '';
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },

    /**
     * Exports tabular data as a downloadable CSV file.
     */
    exportToCsv(filename, headers, rows) {
      if (!rows || !rows.length) return;
      const escapeCell = (val) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvContent = [
        headers.map(escapeCell).join(','),
        ...rows.map(row => row.map(escapeCell).join(','))
      ].join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    /**
     * Exports a Chart.js canvas instance as a downloadable PNG image.
     */
    exportChartAsPng(chartInstance, filename = 'chart.png') {
      if (!chartInstance || !chartInstance.canvas) return;
      const url = chartInstance.toBase64Image('image/png', 1.0);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename.endsWith('.png') ? filename : `${filename}.png`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },

    /**
     * Exports MULTIPLE Chart.js canvas instances as a single stacked PNG.
     * Use this for views made of several small charts (e.g. a cross-room
     * comparison with one chart per metric) where there's no single
     * "the chart" to hand to exportChartAsPng. Each chart's own label can
     * be printed above it via `labels` (optional, same length as charts).
     */
    exportChartsAsPng(chartInstances, filename = 'chart.png', labels = []) {
      const charts = (chartInstances || []).filter(c => c && c.canvas);
      if (!charts.length) return;

      const PADDING = 16;
      const LABEL_HEIGHT = 24;
      const GAP = 12;
      const hasLabels = labels.length === charts.length;

      const width = Math.max(...charts.map(c => c.canvas.width)) + PADDING * 2;
      const totalChartsHeight = charts.reduce((sum, c) => sum + c.canvas.height + (hasLabels ? LABEL_HEIGHT : 0), 0);
      const height = totalChartsHeight + PADDING * 2 + GAP * (charts.length - 1);

      const composite = document.createElement('canvas');
      composite.width = width;
      composite.height = height;
      const ctx = composite.getContext('2d');

      // Background matches the app's dark theme so exported PNGs don't have
      // a jarring transparent/white background when opened outside the app.
      let bg = '#0F1A15';
      let textColor = '#EAF3EC';
      try {
        bg = this.cssVar('--card') || bg;
        textColor = this.cssVar('--text-primary') || textColor;
      } catch (e) { /* fall back to the defaults above */ }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      let y = PADDING;
      charts.forEach((chart, i) => {
        if (hasLabels) {
          ctx.fillStyle = textColor;
          ctx.font = '600 14px sans-serif';
          ctx.fillText(labels[i], PADDING, y + 16);
          y += LABEL_HEIGHT;
        }
        ctx.drawImage(chart.canvas, PADDING, y);
        y += chart.canvas.height + GAP;
      });

      const url = composite.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename.endsWith('.png') ? filename : `${filename}.png`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // -------------------------------------------------------------
  // Decoupled EventBus (Pub/Sub)
  // -------------------------------------------------------------
  const listeners = new Map();
  const EventBus = {
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return () => EventBus.off(event, callback);
    },
    off(event, callback) {
      if (listeners.has(event)) {
        listeners.get(event).delete(callback);
      }
    },
    emit(event, data) {
      if (listeners.has(event)) {
        listeners.get(event).forEach(cb => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[PulseDC.EventBus] Error in handler for event "${event}":`, e);
          }
        });
      }
    }
  };

  PulseDC.API = API;
  PulseDC.Utils = Utils;
  PulseDC.EventBus = EventBus;

  global.PulseDC = PulseDC;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PulseDC;
  }
})(typeof window !== 'undefined' ? window : this);