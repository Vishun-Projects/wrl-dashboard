const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ddmapuyghfeoyajxbcjh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbWFwdXlnaGZlb3lhanhiY2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTc0NDEsImV4cCI6MjA5NDEzMzQ0MX0.zuZGg_M1xvu_wej46ogvAIMyDsEPpNB2g8XhsaxY9dA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCache() {
  console.log('--- Checking calls_cache content ---');
  
  const { count, error } = await supabase.from('calls_cache').select('*', { count: 'exact', head: true });
  if (error) { console.error('Error:', error); return; }
  console.log('Total records in cache:', count);

  const { data: offices } = await supabase.from('calls_cache').select('office_id');
  const distinctOffices = [...new Set(offices?.map(o => o.office_id))];
  console.log('Distinct office_ids in cache:', distinctOffices);

  const { data: statuses } = await supabase.from('calls_cache').select('status_label');
  const distinctStatuses = [...new Set(statuses?.map(s => s.status_label))];
  console.log('Distinct status_labels in cache:', distinctStatuses);

  const { data: samples } = await supabase.from('calls_cache').select('*').limit(1);
  console.log('Sample Record LoggedAt:', samples?.[0]?.logged_at);
}

checkCache();
