// ─────────────────────────────────────────────
// src/engine/webhookDispatcher.js
// Webhook delivery with retry — SIMPLE AND CORRECT
// ─────────────────────────────────────────────

const http = require('http');
const https = require('https');
const state = require('../store/state');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Native HTTP POST that does NOT follow redirects automatically.
 * This prevents POST->GET conversion on 301/302 redirects.
 */
function httpPost(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: body,
          location: res.headers.location || null
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Deliver payload to URL. Retry on 5xx. Stop after 45 seconds max.
 */
async function deliverWithRetry(url, payload) {
  const deadline = Date.now() + 45000; // 45s hard deadline

  for (let attempt = 1; attempt <= 30; attempt++) {
    if (Date.now() > deadline) {
      console.log(`[WH] DEADLINE exceeded for ${url}`);
      return false;
    }

    try {
      const result = await httpPost(url, payload);

      if (result.status >= 200 && result.status < 300) {
        console.log(`[WH] ✅ DELIVERED to ${url} (status=${result.status}, attempt=${attempt})`);
        state.metrics.webhook_deliveries++;
        return true;
      }

      console.log(`[WH] ${url} -> ${result.status} body="${(result.body || '').slice(0, 200)}" attempt #${attempt}`);

      // Follow redirects manually (preserving POST method)
      if ([301, 302, 307, 308].includes(result.status) && result.location) {
        console.log(`[WH] Following redirect to ${result.location}`);
        url = result.location;
        continue;
      }

      if (result.status === 500 || result.status === 502 || result.status === 503 || result.status === 504) {
        await sleep(1000);
        continue;
      }

      // Non-transient, non-redirect — stop
      return false;

    } catch (err) {
      console.log(`[WH] ${url} -> ERROR ${err.code || err.message}, retry #${attempt}`);
      await sleep(1000);
    }
  }

  console.log(`[WH] ❌ FAILED ${url} after max attempts`);
  return false;
}

/**
 * Build Slack attachment payload per PDF spec
 */
function buildSlackPayload(alertObj, integration) {
  const isFired = !!alertObj.fired_at && alertObj.status !== 'resolved';
  const ts = Math.floor(new Date(alertObj.fired_at || new Date()).getTime() / 1000);

  return {
    username: integration.username || 'ProxyWatch',
    text: isFired
      ? `Alert Fired: Proxy pool failure rate (${alertObj.failure_rate}) exceeded threshold (${alertObj.threshold})`
      : `Alert Resolved: Alert ${alertObj.alert_id} has been resolved`,
    attachments: [{
      color: isFired ? '#FF0000' : '#36A64F',
      fields: [
        { title: 'Alert ID', value: String(alertObj.alert_id) },
        { title: 'Failure Rate', value: String(alertObj.failure_rate) },
        { title: 'Failed Proxies', value: String(alertObj.failed_proxies) },
        { title: 'Threshold', value: String(alertObj.threshold) },
        { title: 'Failed IDs', value: (alertObj.failed_proxy_ids || []).join(', ') || 'None' },
        { title: 'Fired At', value: String(alertObj.fired_at) }
      ],
      footer: 'ProxyMaze Alert System',
      ts: ts
    }]
  };
}

/**
 * Build Discord embed payload per PDF spec
 */
function buildDiscordPayload(alertObj, integration) {
  const isFired = !!alertObj.fired_at && alertObj.status !== 'resolved';

  return {
    embeds: [{
      title: isFired ? 'Alert Fired' : 'Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate (${alertObj.failure_rate}) exceeded threshold (${alertObj.threshold})`
        : `Alert ${alertObj.alert_id} has been resolved`,
      color: isFired ? 16711680 : 65280,
      fields: [
        { name: 'Alert ID', value: String(alertObj.alert_id) },
        { name: 'Failure Rate', value: String(alertObj.failure_rate) },
        { name: 'Failed Proxies', value: String(alertObj.failed_proxies) },
        { name: 'Threshold', value: String(alertObj.threshold) },
        { name: 'Failed IDs', value: (alertObj.failed_proxy_ids || []).join(', ') || 'None' }
      ],
      footer: { text: 'ProxyMaze Alert System' }
    }]
  };
}

/**
 * Dispatch webhook event. Exactly-once per (url, event, alert_id).
 * Runs in background — does NOT block the caller.
 */
function dispatchWebhooks(eventPayload) {
  console.log(`[WH] DISPATCH ${eventPayload.event} | alert=${eventPayload.alert_id} | webhooks=${state.webhooks.length} integrations=${state.integrations.length}`);

  // Find the full alert object for Slack/Discord payloads
  const fullAlert = state.alerts.find(a => a.alert_id === eventPayload.alert_id) || {};

  // Regular webhooks
  for (const wh of state.webhooks) {
    const key = `${wh.url}|${eventPayload.event}|${eventPayload.alert_id}`;
    if (state.deliveredKeys.has(key)) {
      console.log(`[WH] SKIP duplicate: ${key}`);
      continue;
    }
    // Mark as in-flight immediately to prevent duplicates from sustained breach cycles
    state.deliveredKeys.add(key);

    deliverWithRetry(wh.url, eventPayload).catch(err => {
      console.log(`[WH] delivery error: ${err.message}`);
    });
  }

  // Slack integrations
  for (const int of state.integrations) {
    if (int.type !== 'slack') continue;
    if (int.events && !int.events.includes(eventPayload.event)) continue;

    const key = `${int.webhook_url}|slack|${eventPayload.event}|${eventPayload.alert_id}`;
    if (state.deliveredKeys.has(key)) continue;
    state.deliveredKeys.add(key);

    const slackPayload = buildSlackPayload(fullAlert, int);
    deliverWithRetry(int.webhook_url, slackPayload).catch(() => {});
  }

  // Discord integrations
  for (const int of state.integrations) {
    if (int.type !== 'discord') continue;
    if (int.events && !int.events.includes(eventPayload.event)) continue;

    const key = `${int.webhook_url}|discord|${eventPayload.event}|${eventPayload.alert_id}`;
    if (state.deliveredKeys.has(key)) continue;
    state.deliveredKeys.add(key);

    const discordPayload = buildDiscordPayload(fullAlert, int);
    deliverWithRetry(int.webhook_url, discordPayload).catch(() => {});
  }
}

/**
 * Send the current active alert to a newly-registered integration.
 * Called from POST /integrations when an alert is already active.
 */
function dispatchToNewIntegration(integration, activeAlert) {
  const eventPayload = {
    event: 'alert.fired',
    alert_id: activeAlert.alert_id,
    fired_at: activeAlert.fired_at,
    failure_rate: activeAlert.failure_rate,
    total_proxies: activeAlert.total_proxies,
    failed_proxies: activeAlert.failed_proxies,
    failed_proxy_ids: [...activeAlert.failed_proxy_ids],
    threshold: activeAlert.threshold,
    message: activeAlert.message
  };

  if (integration.events && !integration.events.includes('alert.fired')) return;

  if (integration.type === 'slack') {
    const key = `${integration.webhook_url}|slack|alert.fired|${activeAlert.alert_id}`;
    if (state.deliveredKeys.has(key)) return;
    state.deliveredKeys.add(key);

    const slackPayload = buildSlackPayload(activeAlert, integration);
    console.log(`[INT] Dispatching Slack alert.fired to ${integration.webhook_url}`);
    deliverWithRetry(integration.webhook_url, slackPayload).catch(() => {});
  } else if (integration.type === 'discord') {
    const key = `${integration.webhook_url}|discord|alert.fired|${activeAlert.alert_id}`;
    if (state.deliveredKeys.has(key)) return;
    state.deliveredKeys.add(key);

    const discordPayload = buildDiscordPayload(activeAlert, integration);
    console.log(`[INT] Dispatching Discord alert.fired to ${integration.webhook_url}`);
    deliverWithRetry(integration.webhook_url, discordPayload).catch(() => {});
  }
}

module.exports = { dispatchWebhooks, dispatchToNewIntegration };
