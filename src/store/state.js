// ─────────────────────────────────────────────
// src/store/state.js
// Single source of truth — all in-memory state
// ─────────────────────────────────────────────

const state = {
  config: {
    check_interval_seconds: 30,
    request_timeout_ms: 5000
  },

  proxyPool: new Map(),

  alerts: [],
  activeAlert: null,

  webhooks: [],
  integrations: [],

  // Track which (url + event + alert_id) combos have been successfully delivered
  // to guarantee exactly-once delivery
  deliveredKeys: new Set(),

  metrics: {
    total_checks: 0,
    webhook_deliveries: 0
  }
};

module.exports = state;
