// ─────────────────────────────────────────────
// src/routes/config.js
// POST/GET /config — The Heartbeat
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');
const { restartMonitoringLoop } = require('../engine/monitor');

const router = Router();

router.post('/config', (req, res) => {
  const { check_interval_seconds, request_timeout_ms } = req.body;

  if (check_interval_seconds !== undefined) {
    state.config.check_interval_seconds = Number(check_interval_seconds);
  }
  if (request_timeout_ms !== undefined) {
    state.config.request_timeout_ms = Number(request_timeout_ms);
  }

  // Restart loop immediately with new config
  restartMonitoringLoop();

  res.status(200).json(state.config);
});

router.get('/config', (req, res) => {
  res.status(200).json(state.config);
});

module.exports = router;
