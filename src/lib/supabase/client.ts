import { createBrowserClient } from '@supabase/ssr';
import { isSelfHostedSupabaseUrl } from '@/lib/api/cookie-auth';

/** Self-hosted auth uses httpOnly cookies; stale sb-* localStorage triggers blocked GoTrue refresh. */
function clearStaleSelfHostedAuthStorage(): void {
  if (typeof window === 'undefined' || !isSelfHostedSupabaseUrl()) return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.includes('auth')) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* private browsing */
  }
}

export function createClient() {
  clearStaleSelfHostedAuthStorage();

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Session is renewed via httpOnly cookies on the server — never refresh from the browser.
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
