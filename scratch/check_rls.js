const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

function loadEnv(filename) {
  const filePath = path.join(__dirname, '..', filename);
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
      env[match[1].trim()] = val;
    }
  });
  return env;
}

const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };

async function run() {
  const client = new Client({
    connectionString: env.DATABASE_URL
  });
  await client.connect();
  console.log('Connected to DB');
  try {
    const res = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public';
    `);
    console.log('Tables and Row Security status:');
    console.log(res.rows);

    const policiesRes = await client.query(`
      SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check 
      FROM pg_policies;
    `);
    console.log('Policies:');
    console.log(policiesRes.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
