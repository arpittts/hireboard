const { Pool, types } = require('pg');
require('dotenv').config();

// Keep DATE columns as 'YYYY-MM-DD' strings. By default pg turns them into a
// Date at local midnight, which shifts the day when the server isn't on UTC.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('📦 Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err);
});

module.exports = pool;
