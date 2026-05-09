// ─────────────────────────────────────────────
// src/routes/alerts.js
// GET /alerts — Return all alerts (active + resolved)
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');

const router = Router();

// GET /alerts — All alerts, active and resolved
router.get('/alerts', (req, res) => {
  res.status(200).json(state.alerts);
});

module.exports = router;
