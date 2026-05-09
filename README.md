# 🔥 ProxyMaze'26 — Real-Time Proxy Intelligence API

> **Torch Labs Sri Lanka 2026 Engineering Challenge**
> Build the watchtower we should have had a year ago.

**Final Score: 270/270** (250 Core + 20 Bonus) ✅

---

## 🏗️ Architecture

A real-time proxy health monitoring API built with Node.js & Express. It continuously monitors proxy URLs in the background, detects failures, fires alerts when the failure rate exceeds a threshold, and delivers webhook notifications with retry logic.

```
                    ┌─────────────────────────────┐
  Evaluator ──────► │       Express Server        │
  (HTTP)            │                             │
                    │  Routes (13 endpoints)      │
                    │  ├── /health                │
                    │  ├── /config                │
                    │  ├── /proxies               │
                    │  ├── /alerts                │
                    │  ├── /webhooks              │
                    │  ├── /integrations          │
                    │  └── /metrics               │
                    │                             │
                    │  Engine (background)        │
                    │  ├── monitor.js     ◄──┐    │
                    │  ├── alertEngine.js     │    │ ──► Webhook POST
                    │  └── webhookDispatcher  │    │ ──► Slack/Discord
                    │                   every Ns  │
                    │  State (in-memory Map)      │
                    └─────────────────────────────┘
```

---

## 📦 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **HTTP Client:** Axios (for proxy probing) + Native `http`/`https` (for webhook delivery)
- **State:** In-memory (`Map`, arrays) — no database
- **Tunnel:** Cloudflare Tunnel (for local deployment)

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
# or
node server.js
```

The server runs on port `3000` (or `$PORT` if set).

### 3. Verify it works
```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

---

## 🌐 Deploying for Evaluation

> **⚠️ Don't use Railway/Render free tier** — they silently block outbound POST requests, which breaks webhook delivery.

### Using Cloudflare Tunnel (recommended, free, no account needed):

**Step 1:** Download cloudflared
```powershell
# Windows
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe"
```
```bash
# Linux/Mac
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared
```

**Step 2:** Start server + tunnel (in two terminals)
```bash
# Terminal 1
node server.js

# Terminal 2
./cloudflared tunnel --url http://localhost:3000
```

**Step 3:** Copy the `https://xxx.trycloudflare.com` URL and submit it to the evaluator.

> Keep both terminals open for the entire ~9 minute evaluation!

---

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Returns `{"status": "ok"}` |
| `POST` | `/config` | Set monitoring interval & timeout |
| `GET` | `/config` | Get current config |
| `POST` | `/proxies` | Load proxy URLs into pool |
| `GET` | `/proxies` | Pool summary with failure rate |
| `GET` | `/proxies/:id` | Single proxy detail + history |
| `GET` | `/proxies/:id/history` | Check history array |
| `DELETE` | `/proxies` | Clear pool (preserves alerts) |
| `GET` | `/alerts` | All alerts (active + resolved) |
| `POST` | `/webhooks` | Register webhook receiver |
| `POST` | `/integrations` | Register Slack/Discord integration |
| `GET` | `/metrics` | Operational monitoring data |

---

## ⚙️ How It Works

### Background Monitoring
- Probes ALL proxies every `check_interval_seconds` (default: 30s)
- **2xx** → `up` | **Everything else** (5xx, timeout, connection error) → `down`
- Runs automatically — never triggered by GET requests

### Alert Lifecycle
```
Normal ──[rate ≥ 0.20]──► Active ──[rate < 0.20]──► Resolved ──[rate ≥ 0.20]──► New Alert
```
- At most **one active alert** at a time
- Sustained breach → update existing alert, **no duplicate webhooks**
- New breach after resolution → brand-new `alert_id`

### Webhook Delivery
- Uses **native Node.js `http`/`https`** (not axios — avoids POST→GET redirect bug)
- Retries on `500`, `502`, `503`, `504` with 1s delay
- Follows redirects manually, preserving POST method
- Exactly-once delivery guaranteed via deduplication Set

### Slack & Discord (Bonus)
- Slack: Legacy attachments format with `{title, value}` fields
- Discord: Embeds format with `{name, value}` fields
- Auto-dispatches to newly registered integrations if an alert is already active

---

## 📁 Project Structure

```
├── server.js                    # Express entry point
├── package.json
├── src/
│   ├── store/
│   │   └── state.js             # In-memory state store
│   ├── utils/
│   │   └── proxyId.js           # Extract proxy ID from URL
│   ├── routes/
│   │   ├── health.js            # GET /health + debug endpoints
│   │   ├── config.js            # POST/GET /config
│   │   ├── proxies.js           # CRUD for proxy pool
│   │   ├── alerts.js            # GET /alerts
│   │   ├── webhooks.js          # POST /webhooks
│   │   ├── integrations.js      # POST /integrations
│   │   └── metrics.js           # GET /metrics
│   └── engine/
│       ├── monitor.js           # Background probe loop
│       ├── alertEngine.js       # Alert fire/sustain/resolve
│       └── webhookDispatcher.js # Delivery with retry + Slack/Discord
└── .gitignore
```

---

## 🏆 Score Breakdown

| Phase | Score | Description |
|-------|-------|-------------|
| Phase 1 | 10/10 | Health check & config |
| Phase 2 | 45/45 | Proxy ingestion & background monitoring |
| Phase 3 | 30/30 | Single failure detection |
| Phase 4 | 90/90 | Threshold breach, alerts & webhooks |
| Phase 5 | 20/20 | Alert resolution |
| Phase 6 | 30/30 | Re-breach lifecycle integrity |
| Phase 7 | 25/25 | Pool operations & observability |
| Phase 8 | 20/20 | Slack & Discord bonus |
| **Total** | **270/270** | **Perfect Score** 🎯 |

---

## 🐛 Key Bugs We Discovered

1. **axios POST→GET on redirect:** `axios.post()` follows 301/302 redirects and converts POST to GET. The evaluator's capture server returns 405. Fix: use native `http`/`https`.

2. **Railway blocks outbound POST:** Free tier silently drops outbound POST requests while allowing GET. Fix: use Cloudflare Tunnel.

3. **Integration timing:** Evaluator registers Slack/Discord *after* the alert fires. Fix: dispatch active alert to newly registered integrations immediately.

---

## 📄 License

Built for the Torch Labs ProxyMaze'26 Engineering Challenge.

**Torch Labs • Colombo, Sri Lanka • From Sri Lanka, to the world.** 🇱🇰
