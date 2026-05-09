const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb' }));

let failCount = 2; // first N requests will return 503 to test retry
const received = [];

app.post('/capture', (req, res) => {
  const record = {
    at: new Date().toISOString(),
    headers: req.headers,
    body: req.body
  };
  received.push(record);

  // Simulate transient failures for first few deliveries
  if (failCount > 0) {
    failCount--;
    return res.status(503).send('transient');
  }

  res.status(200).json({ ok: true });
});

app.get('/received', (req, res) => {
  res.json({ count: received.length, received });
});

app.post('/reset', (req, res) => {
  failCount = Number(req.body?.failCount ?? 2);
  received.length = 0;
  res.json({ ok: true, failCount });
});

const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`Manual capture server listening on http://localhost:${port}`);
  console.log(`POST /capture (will 503 first ${failCount} requests), GET /received`);
});
