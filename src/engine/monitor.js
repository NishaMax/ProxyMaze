// ─────────────────────────────────────────────
// src/engine/monitor.js
// Background monitoring loop
// ─────────────────────────────────────────────

const axios = require('axios');
const state = require('../store/state');
const { evaluateAlerts } = require('./alertEngine');

let monitoringInterval = null;
let isRunningCycle = false;

async function probeProxy(proxy) {
  const now = new Date().toISOString();
  const timeoutMs = Number(state.config.request_timeout_ms) || 5000;

  try {
    const res = await axios.get(proxy.url, {
      timeout: timeoutMs,
      validateStatus: () => true,
      maxRedirects: 5
    });

    if (res.status >= 200 && res.status < 300) {
      proxy.status = 'up';
      proxy.consecutive_failures = 0;
      proxy.up_count++;
    } else {
      // Any non-2xx (including 5xx) → down
      proxy.status = 'down';
      proxy.consecutive_failures++;
    }
  } catch (err) {
    // Timeout, connection refused, DNS failure → down
    proxy.status = 'down';
    proxy.consecutive_failures++;
  }

  proxy.last_checked_at = now;
  proxy.total_checks++;
  proxy.history.push({ checked_at: now, status: proxy.status });
  state.metrics.total_checks++;
}

async function runMonitoringCycle() {
  if (state.proxyPool.size === 0) return;
  if (isRunningCycle) return;

  isRunningCycle = true;

  try {
    const proxies = [...state.proxyPool.values()];
    console.log(`[MON] Probing ${proxies.length} proxies...`);

    await Promise.all(proxies.map(p => probeProxy(p)));

    const up = proxies.filter(p => p.status === 'up').length;
    const down = proxies.filter(p => p.status === 'down').length;
    console.log(`[MON] Done: up=${up} down=${down}`);

    evaluateAlerts();
  } catch (err) {
    console.error(`[MON] Cycle error: ${err.message}`);
  } finally {
    isRunningCycle = false;
  }
}

function restartMonitoringLoop() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }

  const intervalMs = (Number(state.config.check_interval_seconds) || 15) * 1000;
  console.log(`[MON] Loop started: interval=${intervalMs}ms timeout=${state.config.request_timeout_ms}ms`);

  runMonitoringCycle();
  monitoringInterval = setInterval(() => runMonitoringCycle(), intervalMs);
}

function triggerImmediateCycle() {
  setTimeout(() => runMonitoringCycle(), 50);
}

module.exports = { restartMonitoringLoop, triggerImmediateCycle };
