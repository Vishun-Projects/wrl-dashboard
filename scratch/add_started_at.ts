import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function addStartedAt() {
    console.log('Adding started_at column to calls_cache...');
    const { error } = await supabase.rpc('exec_sql', {
        sql_query: 'ALTER TABLE calls_cache ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;'
    });
    
    if (error) {
        console.error('Error adding column:', error);
        // Fallback: the user might not have exec_sql RPC
        console.log('If the above failed, please run: ALTER TABLE calls_cache ADD COLUMN started_at TIMESTAMPTZ; in Supabase SQL editor');
    } else {
        console.log('Column added successfully!');
    }
}

addStartedAt();
