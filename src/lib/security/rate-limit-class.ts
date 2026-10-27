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
  // Chunked MB51 uploads (~15 POSTs per file) must not share the default 120/min bucket
  // with other portal traffic or they get 429 mid-import after TRUNCATE.
  if (pathname === '/api/report/mb51-aging' || pathname.startsWith('/api/report/mb51-aging/')) {
    return { limit: 400, windowMs: 60_000, keySuffix: 'mb51-upload' };
  }
  if (
    pathname === '/api/report/call-visits/mm-barcodes' ||
    pathname.startsWith('/api/report/call-visits/mm-barcodes/')
  ) {
    return { limit: 400, windowMs: 60_000, keySuffix: 'mm-barcode-upload' };
  }
  return { limit: 120, windowMs: 60_000, keySuffix: 'default' };
}
