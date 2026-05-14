import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCache() {
  console.log('--- Checking calls_cache content ---');
  
  // 1. Get total count
  const { count } = await supabase.from('calls_cache').select('*', { count: 'exact', head: true });
  console.log('Total records in cache:', count);

  // 2. Get distinct office_ids
  const { data: offices } = await supabase.from('calls_cache').select('office_id');
  const distinctOffices = [...new Set(offices?.map(o => o.office_id))];
  console.log('Distinct office_ids in cache:', distinctOffices);

  // 3. Get distinct status_labels
  const { data: statuses } = await supabase.from('calls_cache').select('status_label');
  const distinctStatuses = [...new Set(statuses?.map(s => s.status_label))];
  console.log('Distinct status_labels in cache:', distinctStatuses);

  // 4. Sample records
  const { data: samples } = await supabase.from('calls_cache').select('*').limit(3);
  console.log('Sample Records:', JSON.stringify(samples, null, 2));
}

checkCache();
