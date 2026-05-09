// ─────────────────────────────────────────────
// src/engine/webhookDispatcher.js
// Webhook delivery with retry on transient failures
// ─────────────────────────────────────────────

const axios = require('axios');
const state = require('../store/state');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deliver a payload to a URL with retry on 500/502/503/504.
 * Must succeed within 60 seconds of the state transition.
 */
async function deliverWithRetry(url, payload) {
  const maxAttempts = 20;
  const retryDelayMs = 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
        validateStatus: () => true,
        maxRedirects: 5
      });

      if ([500, 502, 503, 504].includes(res.status)) {
        if (attempt < maxAttempts) await sleep(retryDelayMs);
        continue;
      }

      state.metrics.webhook_deliveries++;
      return true;

    } catch (err) {
      if (attempt < maxAttempts) await sleep(retryDelayMs);
    }
  }

  return false;
}

/**
 * Format a Slack-style webhook payload
 */
function formatSlackPayload(payload, fullAlert, integration) {
  const timestamp = payload.fired_at || payload.resolved_at || fullAlert.fired_at || new Date().toISOString();
  const ts = Math.floor(new Date(timestamp).getTime() / 1000);
  const isFired = payload.event === 'alert.fired';

  return {
    username: integration.username || 'ProxyWatch',
    text: isFired
      ? `Alert Fired: Proxy pool failure rate (${fullAlert.failure_rate}) exceeded threshold (${fullAlert.threshold})`
      : `Alert Resolved: Alert ${fullAlert.alert_id} has been resolved`,
    attachments: [{
      color: isFired ? '#FF0000' : '#36A64F',
      fields: [
        { title: 'Alert ID', value: String(fullAlert.alert_id || '') },
        { title: 'Failure Rate', value: String(fullAlert.failure_rate != null ? fullAlert.failure_rate : '') },
        { title: 'Failed Proxies', value: String(fullAlert.failed_proxies != null ? fullAlert.failed_proxies : '') },
        { title: 'Threshold', value: String(fullAlert.threshold != null ? fullAlert.threshold : '0.2') },
        { title: 'Failed IDs', value: String((fullAlert.failed_proxy_ids || []).join(', ') || 'None') },
        { title: 'Fired At', value: String(fullAlert.fired_at || '') }
      ],
      footer: 'ProxyMaze Alert System',
      ts: ts
    }]
  };
}

/**
 * Format a Discord-style webhook payload
 */
function formatDiscordPayload(payload, fullAlert, integration) {
  const isFired = payload.event === 'alert.fired';

  return {
    embeds: [{
      title: isFired ? 'Alert Fired' : 'Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate (${fullAlert.failure_rate}) exceeded threshold (${fullAlert.threshold})`
        : `Alert ${fullAlert.alert_id} has been resolved`,
      color: isFired ? 16711680 : 65280,
      fields: [
        { name: 'Alert ID', value: String(fullAlert.alert_id || '') },
        { name: 'Failure Rate', value: String(fullAlert.failure_rate != null ? fullAlert.failure_rate : '') },
        { name: 'Failed Proxies', value: String(fullAlert.failed_proxies != null ? fullAlert.failed_proxies : '') },
        { name: 'Threshold', value: String(fullAlert.threshold != null ? fullAlert.threshold : '0.2') },
        { name: 'Failed IDs', value: String((fullAlert.failed_proxy_ids || []).join(', ') || 'None') }
      ],
      footer: { text: 'ProxyMaze Alert System' }
    }]
  };
}

/**
 * Dispatch an alert event to all registered webhooks and integrations.
 * Runs entirely in the background (fire-and-forget).
 */
function dispatchWebhooks(payload) {
  // Grab the full alert state for Slack/Discord which need missing fields
  const fullAlert = state.alerts.find(a => a.alert_id === payload.alert_id) || payload;

  // Deduplicate webhooks to prevent multiple deliveries if registered multiple times
  const uniqueWebhooks = [...new Map(state.webhooks.map(wh => [wh.url, wh])).values()];
  const uniqueIntegrations = [...new Map(state.integrations.map(int => [int.webhook_url, int])).values()];

  // Regular webhooks
  for (const wh of uniqueWebhooks) {
    deliverWithRetry(wh.url, payload).catch(() => {}); // catch to prevent unhandled rejection
  }

  // Integrations
  for (const integration of uniqueIntegrations) {
    if (!integration.events || integration.events.includes(payload.event)) {
      if (integration.type === 'slack') {
        const slackPayload = formatSlackPayload(payload, fullAlert, integration);
        deliverWithRetry(integration.webhook_url, slackPayload).catch(() => {});
      } else if (integration.type === 'discord') {
        const discordPayload = formatDiscordPayload(payload, fullAlert, integration);
        deliverWithRetry(integration.webhook_url, discordPayload).catch(() => {});
      }
    }
  }
}

module.exports = { dispatchWebhooks };
