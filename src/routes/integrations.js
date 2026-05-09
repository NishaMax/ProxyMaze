// ─────────────────────────────────────────────
// src/routes/integrations.js
// POST /integrations — Register Slack/Discord integration
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');
const { dispatchToNewIntegration } = require('../engine/webhookDispatcher');

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
  console.log(`[INT] Registered ${type} integration: ${webhook_url}`);

  // If there's a currently active alert, immediately dispatch to this new integration
  if (state.activeAlert) {
    console.log(`[INT] Active alert exists (${state.activeAlert.alert_id}), dispatching to new ${type} integration`);
    dispatchToNewIntegration(integration, state.activeAlert);
  }

  res.status(201).json(integration);
});

module.exports = router;
