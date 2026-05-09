// ─────────────────────────────────────────────
// src/engine/alertEngine.js
// Alert lifecycle — fire, sustain, resolve
// ─────────────────────────────────────────────

const crypto = require('crypto');
const state = require('../store/state');
const { dispatchWebhooks } = require('./webhookDispatcher');

function evaluateAlerts() {
  const proxies = [...state.proxyPool.values()];
  const total = proxies.length;
  if (total === 0) return;

  // Wait until at least one proxy has been checked
  if (!proxies.some(p => p.status === 'up' || p.status === 'down')) return;

  const downProxies = proxies.filter(p => p.status === 'down');
  const downCount = downProxies.length;
  const failureRate = downCount / total;
  const failedIds = downProxies.map(p => p.id);

  console.log(`[ALERT] evaluate: ${downCount}/${total} down (rate=${failureRate.toFixed(3)}) activeAlert=${state.activeAlert?.alert_id || 'none'}`);

  if (failureRate >= 0.20 && !state.activeAlert) {
    // ── FIRE ──
    const now = new Date().toISOString();
    const alert = {
      alert_id: `alert-${crypto.randomUUID().slice(0, 8)}`,
      status: 'active',
      failure_rate: failureRate,
      total_proxies: total,
      failed_proxies: downCount,
      failed_proxy_ids: [...failedIds],
      threshold: 0.2,
      fired_at: now,
      resolved_at: null,
      message: 'Proxy pool failure rate exceeded threshold'
    };

    state.alerts.push(alert);
    state.activeAlert = alert;

    console.log(`[ALERT] 🔥 FIRED ${alert.alert_id} rate=${failureRate} failed=[${failedIds}]`);

    dispatchWebhooks({
      event: 'alert.fired',
      alert_id: alert.alert_id,
      fired_at: alert.fired_at,
      failure_rate: alert.failure_rate,
      total_proxies: alert.total_proxies,
      failed_proxies: alert.failed_proxies,
      failed_proxy_ids: [...alert.failed_proxy_ids],
      threshold: alert.threshold,
      message: alert.message
    });

  } else if (failureRate >= 0.20 && state.activeAlert) {
    // ── SUSTAIN — update stats, NO new webhook ──
    state.activeAlert.failure_rate = failureRate;
    state.activeAlert.failed_proxies = downCount;
    state.activeAlert.failed_proxy_ids = [...failedIds];
    state.activeAlert.total_proxies = total;

  } else if (failureRate < 0.20 && state.activeAlert) {
    // ── RESOLVE ──
    const now = new Date().toISOString();
    state.activeAlert.status = 'resolved';
    state.activeAlert.resolved_at = now;
    state.activeAlert.failure_rate = failureRate;
    state.activeAlert.failed_proxies = downCount;
    state.activeAlert.failed_proxy_ids = [...failedIds];

    const alertId = state.activeAlert.alert_id;
    const resolvedAt = now;

    console.log(`[ALERT] ✅ RESOLVED ${alertId} rate=${failureRate}`);

    state.activeAlert = null;

    dispatchWebhooks({
      event: 'alert.resolved',
      alert_id: alertId,
      resolved_at: resolvedAt
    });
  }
}

module.exports = { evaluateAlerts };
