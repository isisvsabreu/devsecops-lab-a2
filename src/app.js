const express = require('express');
const app = express();

app.use(express.json());

// Health check — usado pelo Kubernetes, load balancers, etc.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal
app.get('/api/info', (req, res) => {
  res.json({
    app: 'devsecops-lab-a2',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// SEGURO — parameterized query
app.get('/api/search', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM messages WHERE text = $1',
    [req.query.q]
  );
  res.json(result.rows);
});

// Endpoint com lógica de negócio simples
app.post('/api/validate', (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'Email inválido',
      received: email
    });
  }

  return res.json({
    valid: true,
    email: email.toLowerCase().trim()
  });
});

module.exports = app;