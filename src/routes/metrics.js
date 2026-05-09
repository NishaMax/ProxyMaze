// ─────────────────────────────────────────────
// src/routes/metrics.js
// GET /metrics — Operational monitoring data
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');

const router = Router();

// GET /metrics — Return aggregated operational stats
router.get('/metrics', (req, res) => {
  res.status(200).json({
    total_checks: state.metrics.total_checks,
    current_pool_size: state.proxyPool.size,
    active_alerts: state.activeAlert ? 1 : 0,
    total_alerts: state.alerts.length,
    webhook_deliveries: state.metrics.webhook_deliveries
  });
});

module.exports = router;
