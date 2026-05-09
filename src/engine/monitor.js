// ─────────────────────────────────────────────
// src/engine/monitor.js
// Background monitoring loop — the heart of ProxyMaze
// ─────────────────────────────────────────────

const axios = require('axios');
const state = require('../store/state');
const { evaluateAlerts } = require('./alertEngine');

let monitoringInterval = null;
let isRunningCycle = false; // Guard against concurrent cycles

/**
 * Probe a single proxy URL.
 * - 2xx within timeout → "up"
 * - 5xx, timeout, connection error → "down"
 */
async function probeProxy(proxy) {
  const now = new Date().toISOString();

  try {
    const response = await axios.get(proxy.url, {
      timeout: state.config.request_timeout_ms,
      validateStatus: () => true, // Don't throw on any HTTP status
      maxRedirects: 5
    });

    if (response.status >= 200 && response.status < 300) {
      // 2xx → UP
      proxy.status = 'up';
      proxy.consecutive_failures = 0;
      proxy.up_count++;
    } else if (response.status >= 500) {
      // 5xx → DOWN
      proxy.status = 'down';
      proxy.consecutive_failures++;
    } else {
      // 3xx, 4xx → treat as UP (spec only lists 5xx as down)
      proxy.status = 'up';
      proxy.consecutive_failures = 0;
      proxy.up_count++;
    }
  } catch (err) {
    // Timeout, connection refused, DNS failure, etc. → DOWN
    proxy.status = 'down';
    proxy.consecutive_failures++;
  }

  proxy.last_checked_at = now;
  proxy.total_checks++;
  proxy.history.push({ checked_at: now, status: proxy.status });
  state.metrics.total_checks++;
}

/**
 * Run one complete monitoring cycle:
 * 1. Probe all proxies concurrently
 * 2. Evaluate alert conditions
 */
async function runMonitoringCycle() {
  if (state.proxyPool.size === 0) return;
  if (isRunningCycle) return; // Prevent overlapping cycles

  isRunningCycle = true;

  try {
    const proxies = [...state.proxyPool.values()];

    console.log(`[Monitor] Probing ${proxies.length} proxies...`);

    // Probe all proxies concurrently
    await Promise.all(proxies.map(proxy => probeProxy(proxy)));

    // Evaluate alert conditions
    evaluateAlerts();

    const downCount = proxies.filter(p => p.status === 'down').length;
    console.log(`[Monitor] Cycle complete — up: ${proxies.length - downCount}, down: ${downCount}`);
  } catch (err) {
    console.error(`[Monitor] Cycle error: ${err.message}`);
  } finally {
    isRunningCycle = false;
  }
}

/**
 * Start or restart the background monitoring loop.
 * Called on startup and when POST /config changes the interval.
 */
function restartMonitoringLoop() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }

  const intervalMs = state.config.check_interval_seconds * 1000;

  console.log(`[Monitor] Starting loop — interval: ${state.config.check_interval_seconds}s, timeout: ${state.config.request_timeout_ms}ms`);

  // Run first cycle immediately (picks up any existing proxies)
  runMonitoringCycle();

  monitoringInterval = setInterval(() => {
    runMonitoringCycle();
  }, intervalMs);
}

/**
 * Trigger an immediate monitoring cycle (e.g., when proxies are loaded).
 * Does not restart the interval — just runs one cycle now.
 */
function triggerImmediateCycle() {
  runMonitoringCycle();
}

module.exports = { restartMonitoringLoop, triggerImmediateCycle };
