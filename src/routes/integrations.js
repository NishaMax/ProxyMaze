// ─────────────────────────────────────────────
// src/routes/integrations.js
// POST /integrations — Register Slack/Discord integration
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');

const router = Router();

// POST /integrations — Register Slack or Discord webhook
router.post('/integrations', (req, res) => {
  const { type, webhook_url, username, events } = req.body;

  if (!type || !webhook_url) {
    return res.status(400).json({ error: 'type and webhook_url are required' });
  }

  const integration = {
    type,
    webhook_url,
    username: username || 'ProxyWatch',
    events: events || ['alert.fired', 'alert.resolved']
  };

  state.integrations.push(integration);

  res.status(201).json(integration);
});

module.exports = router;
