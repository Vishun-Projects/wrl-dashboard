/** Tighter limits for auth (esp. forgot-password) and heavy report/export paths. */

export function rateLimitClassForPath(pathname: string): {
  limit: number;
  windowMs: number;
  keySuffix: string;
} {
  if (pathname === '/api/auth/forgot-password' || pathname.startsWith('/api/auth/forgot-password/')) {
    return { limit: 5, windowMs: 15 * 60_000, keySuffix: 'auth-forgot' };
  }
  if (pathname === '/api/auth/sign-in' || pathname.startsWith('/api/auth/sign-in/')) {
    return { limit: 5, windowMs: 15 * 60_000, keySuffix: 'auth-signin' };
  }
  if (pathname.startsWith('/api/auth/')) {
    return { limit: 20, windowMs: 60_000, keySuffix: 'auth' };
  }
  if (
    pathname.includes('/report/corpus') ||
    pathname.includes('/report/drilldown') ||
    pathname.includes('export=bulk')
  ) {
    return { limit: 10, windowMs: 60_000, keySuffix: 'heavy' };
  }
  return { limit: 120, windowMs: 60_000, keySuffix: 'default' };
}
