// ─────────────────────────────────────────────
// src/engine/alertEngine.js
// Alert lifecycle — fire, sustain, resolve
// ─────────────────────────────────────────────

const crypto = require('crypto');
const state = require('../store/state');
const { dispatchWebhooks } = require('./webhookDispatcher');

// Track which alert_ids have already had their fired webhook dispatched
// This prevents duplicate webhook deliveries during persistent breaches
const firedWebhooksSent = new Set();

/**
 * Evaluate alert conditions after each monitoring cycle.
 * 
 * Rules:
 * - Fire alert when failure_rate >= 0.20 AND no active alert
 * - Resolve when failure_rate < 0.20 AND active alert exists
 * - During sustained breach: update existing alert, NO new alert, NO duplicate webhooks
 * - After resolution + new breach: brand new alert_id
 */
function evaluateAlerts() {
  const proxies = [...state.proxyPool.values()];
  const total = proxies.length;

  if (total === 0) return;

  // Only count proxies that have been checked (not "pending")
  const checkedProxies = proxies.filter(p => p.status === 'up' || p.status === 'down');
  if (checkedProxies.length === 0) return; // All still pending

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
    firedWebhooksSent.add(alert.alert_id);

    console.log(`[Alert] FIRED ${alert.alert_id} — failure_rate: ${failureRate.toFixed(2)}, down: ${downCount}/${total}, failed: [${failedIds.join(', ')}]`);

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
    // ── 🔄 Breach continues — update existing alert, NO new webhook ──
    state.activeAlert.failure_rate = failureRate;
    state.activeAlert.failed_proxies = downCount;
    state.activeAlert.failed_proxy_ids = [...failedIds];
    state.activeAlert.total_proxies = total;
    // Absolutely do NOT dispatch another webhook or create another alert

  } else if (failureRate < 0.20 && state.activeAlert) {
    // ── ✅ RESOLVE ──
    const now = new Date().toISOString();
    state.activeAlert.status = 'resolved';
    state.activeAlert.resolved_at = now;
    // Update the failed set to reflect current state (recovered)
    state.activeAlert.failure_rate = failureRate;
    state.activeAlert.failed_proxies = downCount;
    state.activeAlert.failed_proxy_ids = [...failedIds];

    console.log(`[Alert] RESOLVED ${state.activeAlert.alert_id} — failure_rate dropped to ${failureRate.toFixed(2)}`);

    dispatchWebhooks({
      event: 'alert.resolved',
      alert_id: state.activeAlert.alert_id,
      resolved_at: state.activeAlert.resolved_at
    });

    state.activeAlert = null; // Ready for next breach
  }
}

module.exports = { evaluateAlerts };
