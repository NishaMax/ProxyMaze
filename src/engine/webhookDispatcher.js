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
  const maxAttempts = 25;
  const retryDelayMs = 1000; // 1s between retries → 25s max total retry time

  console.log(`[Webhook] Starting delivery to ${url}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
        validateStatus: () => true,
        maxRedirects: 5
      });

      // Transient failure — retry
      if ([500, 502, 503, 504].includes(res.status)) {
        console.log(`[Webhook] Transient ${res.status} from ${url} (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) await sleep(retryDelayMs);
        continue;
      }

      // Success
      state.metrics.webhook_deliveries++;
      console.log(`[Webhook] ✅ Delivered to ${url} (status: ${res.status}, attempt: ${attempt})`);
      return true;

    } catch (err) {
      console.log(`[Webhook] Error to ${url}: ${err.code || err.message} (attempt ${attempt}/${maxAttempts})`);
      if (attempt < maxAttempts) await sleep(retryDelayMs);
    }
  }

  console.error(`[Webhook] ❌ FAILED delivery to ${url} after ${maxAttempts} attempts`);
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
      ? `Alert Fired: Proxy pool failure rate (${alertEvent.failure_rate}) exceeded threshold (${alertEvent.threshold})`
      : `Alert Resolved: Alert ${alertEvent.alert_id} has been resolved`,
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
      title: isFired ? 'Alert Fired' : 'Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate (${alertEvent.failure_rate}) exceeded threshold (${alertEvent.threshold})`
        : `Alert ${alertEvent.alert_id} has been resolved`,
      color: isFired ? 16711680 : 65280,
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
 * Returns a Promise that resolves when ALL deliveries complete.
 */
async function dispatchWebhooks(payload) {
  const promises = [];

  console.log(`[Webhook] Dispatching ${payload.event} → ${state.webhooks.length} webhooks, ${state.integrations.length} integrations`);

  // Regular webhooks
  for (const wh of state.webhooks) {
    promises.push(deliverWithRetry(wh.url, payload));
  }

  // Slack integrations
  for (const integration of state.integrations) {
    if (integration.type === 'slack' && (!integration.events || integration.events.includes(payload.event))) {
      const slackPayload = formatSlackPayload(payload, integration);
      promises.push(deliverWithRetry(integration.webhook_url, slackPayload));
    }
  }

  // Discord integrations
  for (const integration of state.integrations) {
    if (integration.type === 'discord' && (!integration.events || integration.events.includes(payload.event))) {
      const discordPayload = formatDiscordPayload(payload, integration);
      promises.push(deliverWithRetry(integration.webhook_url, discordPayload));
    }
  }

  // Wait for ALL deliveries to complete (or fail)
  if (promises.length > 0) {
    const results = await Promise.allSettled(promises);
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.length - succeeded;
    console.log(`[Webhook] Dispatch complete: ${succeeded} succeeded, ${failed} failed`);
  } else {
    console.log(`[Webhook] No receivers registered for ${payload.event}`);
  }
}

module.exports = { dispatchWebhooks };
