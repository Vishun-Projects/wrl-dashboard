const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Basic .env parser
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars');
  console.log('Available keys:', Object.keys(env));
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setup() {
  console.log('Setting up Supabase Storage for URL:', supabaseUrl);
  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;

    if (!buckets.find(b => b.name === 'profiles')) {
      console.log('Creating "profiles" bucket...');
      const { error: createError } = await supabase.storage.createBucket('profiles', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif'],
        fileSizeLimit: 2097152 // 2MB
      });
      if (createError) throw createError;
      console.log('Bucket created!');
    } else {
      console.log('Bucket "profiles" already exists.');
    }
    
    // Set bucket as public (just in case)
    await supabase.storage.updateBucket('profiles', { public: true });
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

setup();
