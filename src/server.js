const app = require('./app');
const initDB = require('./init-db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
  } catch (err) {
    console.error('Database init failed:', err.message);
    // App sobe mesmo sem banco (health check funciona)
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();