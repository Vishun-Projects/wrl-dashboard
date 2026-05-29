/**
 * Must be the first import in read-model CLI entrypoints so DATABASE_URL and
 * other vars are loaded before any module that touches Supabase or Postgres pools.
 */
import { loadEnv } from '@/lib/read-model/db';

loadEnv();
process.env.USE_DIRECT_DATABASE = 'true';
