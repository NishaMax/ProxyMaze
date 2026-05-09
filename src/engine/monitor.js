// ─────────────────────────────────────────────
// src/engine/monitor.js
// Background monitoring loop — the heart of ProxyMaze
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await axios.get(proxy.url, {
      timeout: timeoutMs,
      signal: controller.signal,
      validateStatus: () => true,
      maxRedirects: 5,
      responseType: 'text',
      maxContentLength: 1024 * 10
    });

    clearTimeout(timeoutId);

    if (response.status >= 200 && response.status < 300) {
      proxy.status = 'up';
      proxy.consecutive_failures = 0;
      proxy.up_count++;
    } else {
      proxy.status = 'down';
      proxy.consecutive_failures++;
    }
  } catch (err) {
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
    await Promise.all(proxies.map(proxy => probeProxy(proxy)));

    // Synchronous evaluateAlerts so we don't block the next monitoring cycle
    evaluateAlerts();
  } catch (err) {
    console.error(`[Monitor] Cycle error: ${err.message}`);
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

  runMonitoringCycle();
  monitoringInterval = setInterval(() => {
    runMonitoringCycle();
  }, intervalMs);
}

function triggerImmediateCycle() {
  if (isRunningCycle) {
    // If a cycle is running, try again shortly to ensure newly added proxies are caught quickly
    setTimeout(triggerImmediateCycle, 200);
  } else {
    setTimeout(() => runMonitoringCycle(), 10);
  }
}

module.exports = { restartMonitoringLoop, triggerImmediateCycle };
