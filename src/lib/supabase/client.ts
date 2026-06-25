import { createBrowserClient } from '@supabase/ssr';
import { browserTokenRefreshDisabled } from '@/lib/api/cookie-auth';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    browserTokenRefreshDisabled()
      ? {
          auth: {
            // Session lives in httpOnly cookies (sign-in API). Browser must not refresh via GoTrue.
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      : undefined
  );
}
