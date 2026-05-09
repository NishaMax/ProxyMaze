// ─────────────────────────────────────────────
// server.js
// ProxyMaze'26 — Entry Point
// Real-Time Proxy Health Monitoring API
// ─────────────────────────────────────────────

const express = require('express');
const { restartMonitoringLoop } = require('./src/engine/monitor');

// ─── Initialize Express ───
const app = express();
app.use(express.json());

// ─── Mount Routes ───
app.use(require('./src/routes/health'));
app.use(require('./src/routes/config'));
app.use(require('./src/routes/proxies'));
app.use(require('./src/routes/alerts'));
app.use(require('./src/routes/webhooks'));
app.use(require('./src/routes/integrations'));
app.use(require('./src/routes/metrics'));

// ─── Global Error Handler ───
// Catches any unhandled errors so the server never crashes
app.use((err, req, res, next) => {
  console.error(`[Server] Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Catch unhandled promise rejections ───
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err.message);
});

// ─── Start Server ───
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🔥 ProxyMaze API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Config: http://localhost:${PORT}/config\n`);

  // Start the background monitoring loop
  restartMonitoringLoop();
});
