const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ddmapuyghfeoyajxbcjh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbWFwdXlnaGZlb3lhanhiY2poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTc0NDEsImV4cCI6MjA5NDEzMzQ0MX0.zuZGg_M1xvu_wej46ogvAIMyDsEPpNB2g8XhsaxY9dA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function purgeFutureCache() {
  console.log('--- Purging Future-Dated Records ---');
  
  // Delete records in the future (relative to May 2026)
  const now = new Date('2026-05-13').toISOString();
  const { count, error } = await supabase
    .from('calls_cache')
    .delete()
    .gt('logged_at', now);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Successfully purged future records.');
  }
}

purgeFutureCache();
