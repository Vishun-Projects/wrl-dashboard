const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.oyksueuopvsqzndayunb:Fast-Close%402025@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
  });
  await client.connect();
  console.log('Connected to DB');
  try {
    await client.query('ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;');
    console.log('Column avatar_url added to app_users');
  } catch (err) {
    console.error('Error adding column:', err.message);
  } finally {
    await client.end();
  }
}

run();
