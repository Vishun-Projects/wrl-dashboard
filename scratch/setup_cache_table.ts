import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function setupCacheTable() {
  console.log('--- Setting up calls_cache table ---');
  
  // Note: Since I cannot run raw SQL migration directly via the client without an RPC,
  // I will check if the table exists by trying to select from it.
  const { error } = await supabase.from('calls_cache').select('id').limit(1);
  
  if (error && error.code === 'PGRST116') {
     console.log('Table calls_cache does not exist. Please run the following SQL in your Supabase SQL Editor:');
     console.log(`
CREATE TABLE calls_cache (
  id              TEXT PRIMARY KEY,
  vtrnno          TEXT,
  customer_name   TEXT,
  engineer_name   TEXT,
  branch_name     TEXT,
  office_id       TEXT,
  status_label    TEXT,
  is_major        BOOLEAN,
  visit_count     INT DEFAULT 0,
  part_count      INT DEFAULT 0,
  logged_at       TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  synced_at       TIMESTAMPTZ,
  serial_number   TEXT,
  manual_job_no   TEXT,
  vcomplaint      TEXT,
  vlocation       TEXT,
  review_status   TEXT DEFAULT 'unseen',
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ
);

CREATE INDEX idx_cache_logged   ON calls_cache(logged_at DESC);
CREATE INDEX idx_cache_review   ON calls_cache(review_status, logged_at DESC);
CREATE INDEX idx_cache_office   ON calls_cache(office_id, logged_at DESC);
     `);
  } else {
    console.log('Table calls_cache already exists or check failed:', error?.message);
  }
}

setupCacheTable();
