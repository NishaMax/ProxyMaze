# ProxyMaze'26

**Real-Time Proxy Health Monitoring API** — Built for the Torch Labs Engineering Challenge 2026.

A backend service that continuously monitors a pool of proxy URLs, detects failures, fires alerts, and delivers webhook notifications.

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js
- **HTTP Client:** Axios
- **Storage:** In-memory (no database required)

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The server runs on port `3000` by default (configurable via `PORT` environment variable).

## API Endpoints

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | GET | `/health` | Service health check |
| 2 | POST | `/config` | Set monitoring configuration |
| 3 | GET | `/config` | Get current configuration |
| 4 | POST | `/proxies` | Load proxy URLs into pool |
| 5 | GET | `/proxies` | Pool overview with failure rate |
| 6 | GET | `/proxies/:id` | Single proxy details + history |
| 7 | GET | `/proxies/:id/history` | Proxy check history |
| 8 | DELETE | `/proxies` | Clear proxy pool |
| 9 | GET | `/alerts` | All alerts (active + resolved) |
| 10 | POST | `/webhooks` | Register webhook receiver |
| 11 | POST | `/integrations` | Register Slack/Discord integration |
| 12 | GET | `/metrics` | Operational statistics |

## Architecture

```
server.js                  ← Entry point
src/
├── engine/
│   ├── monitor.js         ← Background monitoring loop
│   ├── alertEngine.js     ← Alert lifecycle (fire/resolve)
│   └── webhookDispatcher.js ← Webhook delivery with retry
├── routes/
│   ├── health.js, config.js, proxies.js
│   ├── alerts.js, webhooks.js, integrations.js
│   └── metrics.js
├── store/state.js         ← In-memory state
└── utils/proxyId.js       ← URL → ID extraction
```

## Key Features

- **Background Monitoring** — Continuous health checks on configurable intervals
- **Real HTTP Probing** — 2xx = up, 5xx/timeout/connection error = down
- **Alert Lifecycle** — Fires at ≥20% failure rate, resolves when below
- **Webhook Delivery** — Retry on transient failures (500/502/503/504)
- **Slack & Discord** — Formatted alert integrations

---

*Team Cirq3 — ProxyMaze'26 Challenge*
