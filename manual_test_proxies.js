const express = require('express');
const app = express();

// Accept optional proxy id as trailing path segment.
// Always 200
app.get(['/proxy/up', '/proxy/up/:id'], (req, res) => res.status(200).send('ok'));

// Always 500
app.get(['/proxy/down5xx', '/proxy/down5xx/:id'], (req, res) => res.status(500).send('boom'));

// Timeout simulation: keep connection open longer than typical request_timeout_ms
app.get(['/proxy/timeout', '/proxy/timeout/:id'], (req, res) => {
  setTimeout(() => {
    res.status(200).send('late ok');
  }, 15000);
});

const port = process.env.PORT || 4002;
app.listen(port, () => {
  console.log(`Manual proxy targets listening on http://localhost:${port}`);
  console.log('Routes: /proxy/up(/:id) (200), /proxy/down5xx(/:id) (500), /proxy/timeout(/:id) (hangs)');
});
