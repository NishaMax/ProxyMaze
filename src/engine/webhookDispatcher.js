// ─────────────────────────────────────────────
// src/engine/webhookDispatcher.js
// Webhook delivery with retry on transient failures
// ─────────────────────────────────────────────

const axios = require('axios');
const state = require('../store/state');

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
  const maxAttempts = 15;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: () => true // Don't throw on any HTTP status
      });

      // Transient failure — retry
      if ([500, 502, 503, 504].includes(res.status)) {
        console.log(`[Webhook] Transient ${res.status} from ${url}, retrying (${attempt}/${maxAttempts})...`);
        await sleep(retryDelayMs);
        continue;
      }

      // Success — any non-transient response
      state.metrics.webhook_deliveries++;
      console.log(`[Webhook] Delivered to ${url} (status: ${res.status})`);
      return;

    } catch (err) {
      // Network error (timeout, DNS, connection refused) — retry
      console.log(`[Webhook] Network error to ${url}: ${err.message}, retrying (${attempt}/${maxAttempts})...`);
      await sleep(retryDelayMs);
    }
  }

  console.error(`[Webhook] FAILED to deliver to ${url} after ${maxAttempts} attempts`);
}

/**
 * Format a Slack-style webhook payload
 */
function formatSlackPayload(alertEvent, integration) {
  const timestamp = alertEvent.fired_at || alertEvent.resolved_at;
  const ts = Math.floor(new Date(timestamp).getTime() / 1000);

  return {
    username: integration.username || 'ProxyWatch',
    text: `Alert ${alertEvent.event}: ${alertEvent.alert_id}`,
    attachments: [{
      color: alertEvent.event === 'alert.fired' ? '#FF0000' : '#00FF00',
      fields: [
        { title: 'Alert ID', value: alertEvent.alert_id || 'N/A' },
        { title: 'Failure Rate', value: String(alertEvent.failure_rate ?? 'N/A') },
        { title: 'Failed Proxies', value: String(alertEvent.failed_proxies ?? 'N/A') },
        { title: 'Threshold', value: String(alertEvent.threshold ?? 0.2) },
        { title: 'Failed IDs', value: (alertEvent.failed_proxy_ids || []).join(', ') || 'N/A' },
        { title: 'Fired At', value: alertEvent.fired_at || 'N/A' }
      ],
      footer: 'ProxyMaze Alert System',
      ts: ts
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
      title: isFired ? '🚨 Alert Fired' : '✅ Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate (${alertEvent.failure_rate}) exceeded threshold (${alertEvent.threshold})`
        : `Alert ${alertEvent.alert_id} has been resolved`,
      color: isFired ? 16711680 : 65280, // Red or Green as integer
      fields: [
        { name: 'Alert ID', value: alertEvent.alert_id || 'N/A' },
        { name: 'Failure Rate', value: String(alertEvent.failure_rate ?? 'N/A') },
        { name: 'Failed Proxies', value: String(alertEvent.failed_proxies ?? 'N/A') },
        { name: 'Threshold', value: String(alertEvent.threshold ?? 0.2) },
        { name: 'Failed IDs', value: (alertEvent.failed_proxy_ids || []).join(', ') || 'N/A' }
      ],
      footer: { text: 'ProxyMaze Alert System' }
    }]
  };
}

/**
 * Dispatch an alert event to all registered webhooks and integrations.
 * Runs asynchronously — does not block the monitoring loop.
 */
function dispatchWebhooks(payload) {
  // Regular webhooks
  for (const wh of state.webhooks) {
    deliverWithRetry(wh.url, payload);
  }

  // Slack integrations
  for (const integration of state.integrations.filter(i => i.type === 'slack')) {
    if (integration.events && integration.events.includes(payload.event)) {
      const slackPayload = formatSlackPayload(payload, integration);
      deliverWithRetry(integration.webhook_url, slackPayload);
    }
  }

  // Discord integrations
  for (const integration of state.integrations.filter(i => i.type === 'discord')) {
    if (integration.events && integration.events.includes(payload.event)) {
      const discordPayload = formatDiscordPayload(payload, integration);
      deliverWithRetry(integration.webhook_url, discordPayload);
    }
  }
}

module.exports = { dispatchWebhooks };
