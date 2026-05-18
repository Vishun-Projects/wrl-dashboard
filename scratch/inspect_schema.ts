import pg from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL;
const cleanedConnectionString = connectionString?.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');

const pool = new pg.Pool({ 
  connectionString: cleanedConnectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const res = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'app_users'
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}

main().catch(console.error);
