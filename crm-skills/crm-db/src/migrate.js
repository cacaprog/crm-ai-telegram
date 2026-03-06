const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://crm_user:change_this_strong_password@localhost/crm_db'
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
