const pg = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: '.env' });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL environment variable is missing!");
  process.exit(1);
}

const cleanedConnectionString = connectionString.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');

const pool = new pg.Pool({ 
  connectionString: cleanedConnectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    console.log("Connecting to PostgreSQL...");
    // Add avatar_url column to app_users table
    const alterQuery = `ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`;
    console.log("Running query:", alterQuery);
    await pool.query(alterQuery);
    console.log("Column avatar_url added successfully or already exists!");
  } catch (err) {
    console.error("Failed to alter table:", err);
  } finally {
    await pool.end();
  }
}

main();
