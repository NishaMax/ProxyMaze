// ─────────────────────────────────────────────
// src/routes/proxies.js
// POST   /proxies          — Load proxy URLs
// GET    /proxies          — Pool overview
// GET    /proxies/:id      — Single proxy details
// GET    /proxies/:id/history — Check history
// DELETE /proxies          — Clear pool
// ─────────────────────────────────────────────

const { Router } = require('express');
const state = require('../store/state');
const { extractProxyId } = require('../utils/proxyId');
const { triggerImmediateCycle } = require('../engine/monitor');

const router = Router();

// POST /proxies — Load proxy URLs into monitoring pool
router.post('/proxies', (req, res) => {
  const { proxies, replace } = req.body;

  if (!proxies || !Array.isArray(proxies)) {
    return res.status(400).json({ error: 'proxies array is required' });
  }

  // If replace: true, clear the current pool (but NOT alerts)
  if (replace === true) {
    state.proxyPool.clear();
  }

  const accepted = [];

  for (const url of proxies) {
    const id = extractProxyId(url);

    const proxyEntry = {
      id,
      url,
      status: 'pending',
      last_checked_at: null,
      consecutive_failures: 0,
      total_checks: 0,
      up_count: 0,
      history: []
    };

    state.proxyPool.set(id, proxyEntry);
    accepted.push({ id, url, status: 'pending' });
  }

  // Respond immediately with pending status
  res.status(201).json({
    accepted: accepted.length,
    proxies: accepted
  });

  // Trigger an immediate monitoring cycle so proxies transition
  // from "pending" to "up"/"down" without waiting for the next interval
  triggerImmediateCycle();
});

// GET /proxies — Pool overview with failure_rate
router.get('/proxies', (req, res) => {
  const proxies = [...state.proxyPool.values()];
  const total = proxies.length;
  const upCount = proxies.filter(p => p.status === 'up').length;
  const downCount = proxies.filter(p => p.status === 'down').length;
  const failureRate = total > 0 ? downCount / total : 0;

  res.status(200).json({
    total,
    up: upCount,
    down: downCount,
    failure_rate: parseFloat(failureRate.toFixed(10)),
    proxies: proxies.map(p => ({
      id: p.id,
      url: p.url,
      status: p.status,
      last_checked_at: p.last_checked_at,
      consecutive_failures: p.consecutive_failures
    }))
  });
});

// GET /proxies/:id — Single proxy details + history
router.get('/proxies/:id', (req, res) => {
  const proxy = state.proxyPool.get(req.params.id);

  if (!proxy) {
    return res.status(404).json({ error: 'Proxy not found' });
  }

  const uptimePercentage = proxy.total_checks > 0
    ? parseFloat(((proxy.up_count / proxy.total_checks) * 100).toFixed(1))
    : 0;

  res.status(200).json({
    id: proxy.id,
    url: proxy.url,
    status: proxy.status,
    last_checked_at: proxy.last_checked_at,
    consecutive_failures: proxy.consecutive_failures,
    total_checks: proxy.total_checks,
    uptime_percentage: uptimePercentage,
    history: proxy.history
  });
});

// GET /proxies/:id/history — Check history array
router.get('/proxies/:id/history', (req, res) => {
  const proxy = state.proxyPool.get(req.params.id);

  if (!proxy) {
    return res.status(404).json({ error: 'Proxy not found' });
  }

  res.status(200).json(proxy.history);
});

// DELETE /proxies — Clear pool, keep alerts
router.delete('/proxies', (req, res) => {
  state.proxyPool.clear();
  res.status(204).send();
});

module.exports = router;
