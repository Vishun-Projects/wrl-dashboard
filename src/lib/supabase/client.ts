import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const isDev = process.env.NODE_ENV === 'development';
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    isDev
      ? {
          auth: {
            // Localhost uses DB sign-in + JWT cookies — GoTrue refresh to api.wrl-fsm.cloud often fails (TLS/firewall).
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      : undefined
  );
}
