import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getClientIp } from '@/lib/security/rate-limit';
import { checkRateLimitKv, rateLimitClassForPath } from '@/lib/security/rate-limit-kv';
import { logSecurityEventBestEffort } from '@/lib/security/audit';

/** Next.js 16 proxy entry — replaces deprecated middleware convention. */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith('/api/')) {
    const ip = getClientIp(request);
    const authHeader = request.headers.get('Authorization');
    const userKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7, 20) : ip;
    const { limit, windowMs, keySuffix } = rateLimitClassForPath(pathname);
    const key = `${keySuffix}:${userKey}:${pathname.split('/').slice(0, 4).join('/')}`;
    const result = await checkRateLimitKv(key, limit, windowMs);
    if (!result.allowed) {
      void logSecurityEventBestEffort({
        eventType: 'security.rate_limit.triggered',
        result: 'denied',
        route: pathname,
        method: request.method,
        ip,
        userAgent: request.headers.get('user-agent'),
        statusCode: 429,
        metadata: {
          summary: `Rate limit triggered (${keySuffix})`,
          actionLabel: 'Rate limit triggered',
          rateClass: keySuffix,
          limit,
          windowMs,
          retryAfterSec: result.retryAfterSec,
        },
      });
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(result.retryAfterSec) },
        }
      );
    }

    if (authHeader?.startsWith('Bearer ') && pathname.startsWith('/api/report/')) {
      return NextResponse.next();
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/admin/performance-snapshot|api/mis-client-import/upload|api/mis-client-import/upload-chunk|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
