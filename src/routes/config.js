// ─────────────────────────────────────────────
// src/routes/config.js
// POST /config — Set monitoring configuration
// GET  /config — Return current configuration
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');
const { restartMonitoringLoop } = require('../engine/monitor');

const router = Router();

// POST /config — Set runtime monitoring config
router.post('/config', (req, res) => {
  const { check_interval_seconds, request_timeout_ms } = req.body;

  if (check_interval_seconds !== undefined) {
    state.config.check_interval_seconds = check_interval_seconds;
  }
  if (request_timeout_ms !== undefined) {
    state.config.request_timeout_ms = request_timeout_ms;
  }

  // Restart the monitoring loop with new cadence immediately
  restartMonitoringLoop();

  res.status(200).json({ ...state.config });
});

// GET /config — Return current config
router.get('/config', (req, res) => {
  res.status(200).json({ ...state.config });
});

module.exports = router;
