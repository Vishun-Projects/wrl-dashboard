/** Same-origin API calls authenticated via httpOnly Supabase session cookies. */
export const cookieAuthRequestConfig = { withCredentials: true as const };

export function isSelfHostedSupabaseUrl(url?: string): boolean {
  const host = (url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').toLowerCase();
  return (
    host.includes('api.wrl-fsm.cloud') ||
    host.includes('127.0.0.1') ||
    host.includes('localhost')
  );
}

/** Browser must not call GoTrue refresh for self-hosted VPS (invalid public TLS cert). */
export function browserTokenRefreshDisabled(): boolean {
  return isSelfHostedSupabaseUrl() || process.env.NODE_ENV === 'development';
}
