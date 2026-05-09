// ─────────────────────────────────────────────
// src/store/state.js
// Single source of truth — all in-memory state
// ─────────────────────────────────────────────

const state = {
  // ─── Runtime Config ───
  config: {
    check_interval_seconds: 30,
    request_timeout_ms: 5000
  },

  // ─── Proxy Pool ───
  // Map<proxyId, ProxyEntry>
  // ProxyEntry = {
  //   id, url, status ("pending"|"up"|"down"),
  //   last_checked_at, consecutive_failures,
  //   total_checks, up_count, history[]
  // }
  proxyPool: new Map(),

  // ─── Alerts ───
  alerts: [],          // Full archive (active + resolved)
  activeAlert: null,   // Reference to current active alert or null

  // ─── Webhooks ───
  webhooks: [],        // [{ webhook_id, url }]

  // ─── Integrations ───
  integrations: [],    // [{ type, webhook_url, username, events }]

  // ─── Metrics ───
  metrics: {
    total_checks: 0,
    webhook_deliveries: 0
  }
};

module.exports = state;
