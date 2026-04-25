const express = require('express');
const app = express();

app.use(express.json());
const pool = require('./db');

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

// SEGURO — parameterized query
app.get('/api/search', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM messages WHERE text = $1',
    [req.query.q]
  );
  res.json(result.rows);
});

// Listar mensagens
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages ORDER BY created_at DESC LIMIT 20'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

// Criar mensagem
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

module.exports = app;