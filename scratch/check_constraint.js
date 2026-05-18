const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.ddmapuyghfeoyajxbcjh:fVC65ldrdaejddD3@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
  });
  await client.connect();
  console.log('Connected to DB');
  try {
    const res = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'public.app_users'::regclass 
      AND conname = 'app_users_role_check';
    `);
    console.log('Constraint definition:', res.rows[0]);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
