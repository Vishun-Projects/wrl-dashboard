import dotenv from 'dotenv';
import path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });

async function run() {
  const readModelUrl = process.env.DATABASE_URL;
  if (!readModelUrl) {
    console.error('DATABASE_URL is missing in .env.local');
    return;
  }
  const client = new Client({ connectionString: readModelUrl });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT table_name, table_type 
       FROM information_schema.tables 
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    console.log('Tables in database:');
    console.table(res.rows);
  } catch (err) {
    console.error('Error listing tables:', err);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
