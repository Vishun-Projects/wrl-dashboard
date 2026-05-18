const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.ddmapuyghfeoyajxbcjh:fVC65ldrdaejddD3@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
  });
  await client.connect();
  console.log('Connected to DB');
  try {
    await client.query('ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;');
    console.log('Constraint app_users_role_check dropped');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
