import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { getClientIp } from '@/lib/security/rate-limit';
import { checkRateLimitKv, rateLimitClassForPath } from '@/lib/security/rate-limit-kv';
import { logSecurityEventBestEffort } from '@/lib/security/audit';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  withRequestIdHeader,
} from '@/lib/observability/request-id';

/** Next.js 16 proxy entry — replaces deprecated middleware convention. */
export async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers);
  const requestHeaders = withRequestIdHeader(request.headers, requestId);
  const requestWithId = new NextRequest(request.url, {
    method: request.method,
    headers: requestHeaders,
    body: request.body,
    redirect: request.redirect,
  });
  const pathname = requestWithId.nextUrl.pathname;

  if (pathname.startsWith('/api/')) {
    const ip = getClientIp(requestWithId);
    const authHeader = requestWithId.headers.get('Authorization');
    const userKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7, 20) : ip;
    const { limit, windowMs, keySuffix } = rateLimitClassForPath(pathname);
    const key = `${keySuffix}:${userKey}:${pathname.split('/').slice(0, 4).join('/')}`;
    const result = await checkRateLimitKv(key, limit, windowMs);
    if (!result.allowed) {
      void logSecurityEventBestEffort({
        eventType: 'security.rate_limit.triggered',
        result: 'denied',
        route: pathname,
        method: requestWithId.method,
        ip,
        userAgent: requestWithId.headers.get('user-agent'),
        statusCode: 429,
        metadata: {
          requestId,
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
          headers: {
            'Retry-After': String(result.retryAfterSec),
            [REQUEST_ID_HEADER]: requestId,
          },
        }
      );
    }

    if (authHeader?.startsWith('Bearer ') && pathname.startsWith('/api/report/')) {
      const response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    }
  }

  const response = await updateSession(requestWithId);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/admin/performance-snapshot|api/mis-client-import/upload|api/mis-client-import/upload-chunk|api/report/spare-loan-check|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
