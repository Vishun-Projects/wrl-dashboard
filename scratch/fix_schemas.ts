import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSchema() {
  console.log('--- Fixing Database Schemas ---');
  
  console.log('Please run this SQL in your Supabase SQL Editor to fix the missing columns and tables:');
  console.log(`
-- 1. Create app_users table for names
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  name TEXT,
  email TEXT,
  role TEXT DEFAULT 'manager'
);

-- 2. Add author_name to call_comments if missing
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='call_comments' AND column_name='author_name') THEN
        ALTER TABLE call_comments ADD COLUMN author_name TEXT;
    END IF;
END $$;

-- 3. Ensure call_comments has author_id
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='call_comments' AND column_name='author_id') THEN
        ALTER TABLE call_comments ADD COLUMN author_id UUID;
    END IF;
END $$;

-- 4. Create call_flags table if missing
CREATE TABLE IF NOT EXISTS call_flags (
  id BIGSERIAL PRIMARY KEY,
  call_id TEXT NOT NULL,
  flag_type TEXT NOT NULL,
  set_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_comments_call_id ON call_comments(call_id);
CREATE INDEX IF NOT EXISTS idx_flags_call_id ON call_flags(call_id);
  `);
}

fixSchema();
