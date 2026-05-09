// ─────────────────────────────────────────────
// src/routes/health.js
// GET /health — Proof of Life
// ─────────────────────────────────────────────

const { Router } = require('express');
const axios = require('axios');
const state = require('../store/state');
const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Debug endpoint to verify deploy version
router.get('/debug/version', (req, res) => {
  res.status(200).json({ version: '6.0.0', deployed_at: new Date().toISOString() });
});

// DIAGNOSTIC: Test if Railway can make outbound POST requests
router.get('/debug/test-outbound', async (req, res) => {
  const results = {};

  // Test 1: Outbound GET (we know this works — proxy probing passes)
  try {
    const getRes = await axios.get('https://httpbin.org/get', { timeout: 10000, validateStatus: () => true });
    results.outbound_get = { success: true, status: getRes.status };
  } catch (err) {
    results.outbound_get = { success: false, error: err.code || err.message };
  }

  // Test 2: Outbound POST (this is what webhooks use)
  try {
    const postRes = await axios.post('https://httpbin.org/post', { test: 'hello' }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true
    });
    results.outbound_post = { success: true, status: postRes.status };
  } catch (err) {
    results.outbound_post = { success: false, error: err.code || err.message };
  }

  // Test 3: Outbound POST to a different service
  try {
    const postRes2 = await axios.post('https://postman-echo.com/post', { test: 'hello' }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true
    });
    results.outbound_post_echo = { success: true, status: postRes2.status };
  } catch (err) {
    results.outbound_post_echo = { success: false, error: err.code || err.message };
  }

  // Current state snapshot
  results.registered_webhooks = state.webhooks.length;
  results.registered_integrations = state.integrations.length;
  results.webhook_urls = state.webhooks.map(w => w.url);
  results.active_alerts = state.alerts.filter(a => a.status === 'active').length;
  results.total_alerts = state.alerts.length;
  results.pool_size = state.proxyPool.size;

  res.json(results);
});

module.exports = router;
