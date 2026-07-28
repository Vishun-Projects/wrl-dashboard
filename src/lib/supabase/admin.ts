import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;

function resolveRealtimeTransport(): unknown {
  if (typeof WebSocket !== 'undefined') return undefined;
  try {
    // Node < 22: supabase-js realtime requires an explicit WebSocket implementation.
    return require('ws');
  } catch {
    return undefined;
  }
}

function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

  if (!supabaseUrl) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (Supabase project URL).'
    );
  }
  if (!supabaseServiceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local for server-side Supabase access.'
    );
  }

  const transport = resolveRealtimeTransport();
  adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(transport ? { realtime: { transport: transport as typeof WebSocket } } : {}),
  });
  return adminClient;
}

/** Admin client for backend operations that need to bypass RLS (lazy — safe for sync-worker CLI). */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseAdmin(), prop, receiver);
  },
});
