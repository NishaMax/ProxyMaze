// ─────────────────────────────────────────────
// src/engine/webhookDispatcher.js
// Webhook delivery with retry on transient failures
// ─────────────────────────────────────────────

const axios = require('axios');
const state = require('../store/state');

// Track all in-flight deliveries to prevent garbage collection
const pendingDeliveries = new Set();

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deliver a payload to a URL with retry on 500/502/503/504.
 * Must succeed within 60 seconds of the state transition.
 */
async function deliverWithRetry(url, payload) {
  const maxAttempts = 20;
  const retryDelayMs = 1500; // 1.5s between retries → 20 * 1.5s = 30s max

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
        validateStatus: () => true, // Don't throw on any HTTP status
        maxRedirects: 5
      });

      // Transient failure — retry
      if ([500, 502, 503, 504].includes(res.status)) {
        console.log(`[Webhook] Transient ${res.status} from ${url}, retrying (${attempt}/${maxAttempts})...`);
        if (attempt < maxAttempts) await sleep(retryDelayMs);
        continue;
      }

      // Success — any non-transient response (2xx, 3xx, 4xx)
      state.metrics.webhook_deliveries++;
      console.log(`[Webhook] ✅ Delivered to ${url} (status: ${res.status}, attempt: ${attempt})`);
      return true;

    } catch (err) {
      // Network error (timeout, DNS, connection refused) — retry
      console.log(`[Webhook] Network error to ${url}: ${err.message}, retrying (${attempt}/${maxAttempts})...`);
      if (attempt < maxAttempts) await sleep(retryDelayMs);
    }
  }

  console.error(`[Webhook] ❌ FAILED to deliver to ${url} after ${maxAttempts} attempts`);
  return false;
}

/**
 * Format a Slack-style webhook payload
 */
function formatSlackPayload(alertEvent, integration) {
  const timestamp = alertEvent.fired_at || alertEvent.resolved_at || new Date().toISOString();
  const ts = Math.floor(new Date(timestamp).getTime() / 1000);
  const isFired = alertEvent.event === 'alert.fired';

  return {
    username: integration.username || 'ProxyWatch',
    text: isFired
      ? `🚨 Alert Fired: Proxy pool failure rate (${alertEvent.failure_rate}) exceeded threshold (${alertEvent.threshold})`
      : `✅ Alert Resolved: Alert ${alertEvent.alert_id} has been resolved`,
    attachments: [{
      color: isFired ? '#FF0000' : '#36A64F',
      fields: [
        { title: 'Alert ID', value: String(alertEvent.alert_id || '') },
        { title: 'Failure Rate', value: String(alertEvent.failure_rate != null ? alertEvent.failure_rate : '') },
        { title: 'Failed Proxies', value: String(alertEvent.failed_proxies != null ? alertEvent.failed_proxies : '') },
        { title: 'Threshold', value: String(alertEvent.threshold != null ? alertEvent.threshold : '0.2') },
        { title: 'Failed IDs', value: String((alertEvent.failed_proxy_ids || []).join(', ') || 'None') },
        { title: 'Fired At', value: String(alertEvent.fired_at || '') }
      ],
      footer: 'ProxyMaze Alert System',
      ts: ts // Must be integer, not float, not string
    }]
  };
}

/**
 * Format a Discord-style webhook payload
 */
function formatDiscordPayload(alertEvent, integration) {
  const isFired = alertEvent.event === 'alert.fired';

  return {
    embeds: [{
      title: isFired ? 'Alert Fired' : 'Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate (${alertEvent.failure_rate}) exceeded threshold (${alertEvent.threshold})`
        : `Alert ${alertEvent.alert_id} has been resolved`,
      color: isFired ? 16711680 : 65280, // Red or Green as integer 0-16777215
      fields: [
        { name: 'Alert ID', value: String(alertEvent.alert_id || '') },
        { name: 'Failure Rate', value: String(alertEvent.failure_rate != null ? alertEvent.failure_rate : '') },
        { name: 'Failed Proxies', value: String(alertEvent.failed_proxies != null ? alertEvent.failed_proxies : '') },
        { name: 'Threshold', value: String(alertEvent.threshold != null ? alertEvent.threshold : '0.2') },
        { name: 'Failed IDs', value: String((alertEvent.failed_proxy_ids || []).join(', ') || 'None') }
      ],
      footer: { text: 'ProxyMaze Alert System' }
    }]
  };
}

/**
 * Dispatch an alert event to all registered webhooks and integrations.
 * All deliveries are tracked to prevent promises from being lost.
 */
function dispatchWebhooks(payload) {
  console.log(`[Webhook] Dispatching ${payload.event} to ${state.webhooks.length} webhooks, ${state.integrations.length} integrations`);

  // Regular webhooks
  for (const wh of state.webhooks) {
    const promise = deliverWithRetry(wh.url, payload)
      .catch(err => console.error(`[Webhook] Delivery error: ${err.message}`))
      .finally(() => pendingDeliveries.delete(promise));
    pendingDeliveries.add(promise);
  }

  // Slack integrations
  for (const integration of state.integrations) {
    if (integration.type === 'slack' && (!integration.events || integration.events.includes(payload.event))) {
      const slackPayload = formatSlackPayload(payload, integration);
      const promise = deliverWithRetry(integration.webhook_url, slackPayload)
        .catch(err => console.error(`[Slack] Delivery error: ${err.message}`))
        .finally(() => pendingDeliveries.delete(promise));
      pendingDeliveries.add(promise);
    }
  }

  // Discord integrations
  for (const integration of state.integrations) {
    if (integration.type === 'discord' && (!integration.events || integration.events.includes(payload.event))) {
      const discordPayload = formatDiscordPayload(payload, integration);
      const promise = deliverWithRetry(integration.webhook_url, discordPayload)
        .catch(err => console.error(`[Discord] Delivery error: ${err.message}`))
        .finally(() => pendingDeliveries.delete(promise));
      pendingDeliveries.add(promise);
    }
  }
}

module.exports = { dispatchWebhooks };
