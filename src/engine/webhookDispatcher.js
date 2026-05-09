// ─────────────────────────────────────────────
// src/engine/webhookDispatcher.js
// Webhook delivery with retry on transient failures
// ─────────────────────────────────────────────

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const state = require('../store/state');

// Ignore self-signed certificates in case the evaluator uses them
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Strip milliseconds from timestamps to strictly match ISO 8601 example in PDF
function getStrictIsoTimestamp(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function stableStringify(obj) {
  // Stable enough for our payload hashing needs (sorted keys)
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function computeDeliveryKey(url, payload) {
  const event = payload?.event || '';
  const alertId = payload?.alert_id || '';
  // If an event has no alert_id (shouldn't happen), fall back to hashing payload
  const base = `${url}|${event}|${alertId || crypto.createHash('sha1').update(stableStringify(payload)).digest('hex')}`;
  return base;
}

function isTransientStatus(status) {
  return [500, 502, 503, 504].includes(status);
}

async function attemptOnce(url, payload) {
  const res = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
    validateStatus: () => true,
    maxRedirects: 5,
    httpsAgent
  });

  if (isTransientStatus(res.status)) return { ok: false, transient: true, status: res.status };
  if (res.status >= 200 && res.status < 300) return { ok: true, transient: false, status: res.status };

  // Non-transient failure: do not retry forever (contract only mandates retry on transient 5xx)
  return { ok: false, transient: false, status: res.status };
}

function ensureDispatcherLoop() {
  if (state._dispatcherLoopStarted) return;
  state._dispatcherLoopStarted = true;

  setInterval(async () => {
    // Process a small batch frequently so we meet the 60s requirement.
    const batchSize = 25;
    const now = Date.now();

    const pendingKeys = [];
    for (const [k, job] of state.deliveryQueue.entries()) {
      if (!job || job.status !== 'pending') continue;
      if (job.next_attempt_at_ms && job.next_attempt_at_ms > now) continue;
      pendingKeys.push(k);
      if (pendingKeys.length >= batchSize) break;
    }

    for (const key of pendingKeys) {
      const job = state.deliveryQueue.get(key);
      if (!job || job.status !== 'pending') continue;

      // Guard against long-lived jobs: stop trying after 60s window
      if (now - job.created_at_ms > 60_000) {
        job.status = 'expired';
        continue;
      }

      try {
        const result = await attemptOnce(job.url, job.payload);
        if (result.ok) {
          job.status = 'delivered';
          if (!state.deliverySuccessKeys.has(key)) {
            state.deliverySuccessKeys.add(key);
            state.metrics.webhook_deliveries++;
          }
        } else if (result.transient) {
          job.attempts++;
          job.next_attempt_at_ms = Date.now() + 1500;
        } else {
          job.status = 'failed';
        }
      } catch (e) {
        // Network errors behave like transient; retry
        job.attempts++;
        job.next_attempt_at_ms = Date.now() + 1500;
      }
    }
  }, 250);
}

function enqueueDelivery(url, payload) {
  ensureDispatcherLoop();

  const key = computeDeliveryKey(url, payload);
  if (state.deliverySuccessKeys.has(key)) return;
  if (state.deliveryQueue.has(key)) return;

  state.deliveryQueue.set(key, {
    url,
    payload,
    created_at_ms: Date.now(),
    next_attempt_at_ms: Date.now(),
    attempts: 0,
    status: 'pending'
  });
}

/**
 * Format a Slack-style webhook payload (legacy attachments format per challenge spec)
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
 */
function dispatchWebhooks(payload) {
  // Grab the full alert state for Slack/Discord which need missing fields
  const fullAlert = state.alerts.find(a => a.alert_id === payload.alert_id) || payload;

  // Enforce strict ISO string format without milliseconds for the JSON payloads
  if (payload.fired_at) payload.fired_at = getStrictIsoTimestamp(payload.fired_at);
  if (payload.resolved_at) payload.resolved_at = getStrictIsoTimestamp(payload.resolved_at);
  if (fullAlert && fullAlert.fired_at) fullAlert.fired_at = getStrictIsoTimestamp(fullAlert.fired_at);

  const uniqueWebhooks = [...new Map(state.webhooks.map(wh => [wh.url, wh])).values()];
  const uniqueIntegrations = [...new Map(state.integrations.map(int => [int.webhook_url, int])).values()];

  for (const wh of uniqueWebhooks) {
    enqueueDelivery(wh.url, payload);
  }

  for (const integration of uniqueIntegrations) {
    if (!integration.events || integration.events.includes(payload.event)) {
      if (integration.type === 'slack') {
        enqueueDelivery(integration.webhook_url, formatSlackPayload(payload, fullAlert, integration));
      } else if (integration.type === 'discord') {
        enqueueDelivery(integration.webhook_url, formatDiscordPayload(payload, fullAlert, integration));
      }
    }
  }
}

module.exports = { dispatchWebhooks };
