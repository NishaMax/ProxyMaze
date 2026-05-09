// ─────────────────────────────────────────────
// src/routes/health.js
// GET /health — Proof of Life
// ─────────────────────────────────────────────

const { Router } = require('express');
const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Hidden debug endpoint to verify deploy version
router.get('/debug/version', (req, res) => {
  res.status(200).json({ version: '4.0.0', deployed_at: new Date().toISOString() });
});

module.exports = router;
