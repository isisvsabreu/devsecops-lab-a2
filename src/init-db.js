const pool = require('./db');

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database initialized');
}

// Se executado diretamente: node src/init-db.js (Job K8s, CLI)
if (require.main === module) {
  initDB()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}

// Se importado: require('./init-db') retorna a função
module.exports = initDB;