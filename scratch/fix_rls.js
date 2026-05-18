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
    console.log('Disabling RLS on app_users...');
    await client.query('ALTER TABLE public.app_users DISABLE ROW LEVEL SECURITY;');
    
    console.log('Disabling RLS on call_flags...');
    await client.query('ALTER TABLE public.call_flags DISABLE ROW LEVEL SECURITY;');

    console.log('Disabling RLS on call_comments...');
    await client.query('ALTER TABLE public.call_comments DISABLE ROW LEVEL SECURITY;');

    console.log('Creating storage.objects policies for profiles bucket...');
    // Drop existing if any, to avoid duplicates
    await client.query('DROP POLICY IF EXISTS "Allow public select profiles" ON storage.objects;');
    await client.query('DROP POLICY IF EXISTS "Allow public insert profiles" ON storage.objects;');
    await client.query('DROP POLICY IF EXISTS "Allow public update profiles" ON storage.objects;');
    await client.query('DROP POLICY IF EXISTS "Allow public delete profiles" ON storage.objects;');

    await client.query(`
      CREATE POLICY "Allow public select profiles" ON storage.objects 
      FOR SELECT TO public USING (bucket_id = 'profiles');
    `);
    await client.query(`
      CREATE POLICY "Allow public insert profiles" ON storage.objects 
      FOR INSERT TO public WITH CHECK (bucket_id = 'profiles');
    `);
    await client.query(`
      CREATE POLICY "Allow public update profiles" ON storage.objects 
      FOR UPDATE TO public USING (bucket_id = 'profiles') WITH CHECK (bucket_id = 'profiles');
    `);
    await client.query(`
      CREATE POLICY "Allow public delete profiles" ON storage.objects 
      FOR DELETE TO public USING (bucket_id = 'profiles');
    `);

    console.log('All changes completed successfully!');
  } catch (err) {
    console.error('Error during execution:', err.message);
  } finally {
    await client.end();
  }
}

run();
