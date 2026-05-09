// ─────────────────────────────────────────────
// src/routes/health.js
// GET /health — Proof of Life
// ─────────────────────────────────────────────

const { Router } = require('express');
const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

module.exports = router;
