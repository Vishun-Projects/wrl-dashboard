import pg from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;
const cleanedConnectionString = connectionString?.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');

const pool = new pg.Pool({ 
  connectionString: cleanedConnectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const sqlPath = path.join(process.cwd(), 'scratch', 'migrate_roles.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('Running migration...');
  await pool.query(sql);
  console.log('Migration completed successfully.');
  
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
