
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function check() {
  const { data, error } = await supabase.rpc('get_table_info', { table_name: 'app_users' })
  if (error) {
    // If RPC fails, try a simple query
    const { data: sample, error: err2 } = await supabase.from('app_users').select('*').limit(1)
    console.log('Sample data:', sample)
    console.log('Error:', err2)
  } else {
    console.log('Columns:', data)
  }
}
check()
