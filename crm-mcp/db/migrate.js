import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/crm'
});

const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
await pool.query(sql);
console.log('Migration complete');
await pool.end();
