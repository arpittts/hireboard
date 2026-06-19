const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  try {
    console.log('🔧 Initializing PostgreSQL database...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Database initialized successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to initialize database:', err.message);
    process.exit(1);
  }
}

initDatabase();
