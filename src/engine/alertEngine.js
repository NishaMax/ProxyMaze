// ─────────────────────────────────────────────
// src/engine/alertEngine.js
// Alert lifecycle — fire, sustain, resolve
// ─────────────────────────────────────────────

const crypto = require('crypto');
const state = require('../store/state');
const { dispatchWebhooks } = require('./webhookDispatcher');

/**
 * Evaluate alert conditions after each monitoring cycle.
 * ASYNC — awaits webhook delivery to ensure it completes.
 */
async function evaluateAlerts() {
  const proxies = [...state.proxyPool.values()];
  const total = proxies.length;

  if (total === 0) return;

  // Only evaluate once at least some proxies have been checked
  const checkedProxies = proxies.filter(p => p.status === 'up' || p.status === 'down');
  if (checkedProxies.length === 0) return;

  const downCount = proxies.filter(p => p.status === 'down').length;
  const failureRate = downCount / total;
  const failedIds = proxies.filter(p => p.status === 'down').map(p => p.id);

  if (failureRate >= 0.20 && !state.activeAlert) {
    // ── 🔥 FIRE new alert ──
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

    console.log(`[Alert] FIRED ${alert.alert_id} — rate: ${failureRate.toFixed(2)}, down: ${downCount}/${total}, failed: [${failedIds.join(', ')}]`);

    // AWAIT webhook delivery — don't let it get lost
    await dispatchWebhooks({
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
    // ── 🔄 Breach continues — update existing alert, NO new webhook ──
    state.activeAlert.failure_rate = failureRate;
    state.activeAlert.failed_proxies = downCount;
    state.activeAlert.failed_proxy_ids = [...failedIds];
    state.activeAlert.total_proxies = total;

  } else if (failureRate < 0.20 && state.activeAlert) {
    // ── ✅ RESOLVE ──
    const now = new Date().toISOString();
    state.activeAlert.status = 'resolved';
    state.activeAlert.resolved_at = now;
    state.activeAlert.failure_rate = failureRate;
    state.activeAlert.failed_proxies = downCount;
    state.activeAlert.failed_proxy_ids = [...failedIds];

    const resolvedAlertId = state.activeAlert.alert_id;
    const resolvedAt = state.activeAlert.resolved_at;

    console.log(`[Alert] RESOLVED ${resolvedAlertId} — rate dropped to ${failureRate.toFixed(2)}`);

    state.activeAlert = null; // Clear BEFORE dispatching to prevent re-entry

    // AWAIT webhook delivery
    await dispatchWebhooks({
      event: 'alert.resolved',
      alert_id: resolvedAlertId,
      resolved_at: resolvedAt
    });
  }
}

module.exports = { evaluateAlerts };
