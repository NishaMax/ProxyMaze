// ─────────────────────────────────────────────
// src/routes/webhooks.js
// POST /webhooks — Register a webhook receiver URL
// ─────────────────────────────────────────────

const { Router } = require('express');
const crypto = require('crypto');
const state = require('../store/state');

const router = Router();

// POST /webhooks — Register a URL to receive alert events
router.post('/webhooks', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const webhook = {
    webhook_id: `wh-${crypto.randomUUID().slice(0, 8)}`,
    url
  };

  state.webhooks.push(webhook);

  res.status(201).json(webhook);
});

module.exports = router;
