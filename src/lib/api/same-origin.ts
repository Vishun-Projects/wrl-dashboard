import { NextResponse } from 'next/server';
import { resolveAppOrigin } from '@/lib/auth/site-url';

function originOf(urlOrOrigin: string): string | null {
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    return null;
  }
}

function hostHeaderOrigin(req: Request): string | null {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
    .split(',')[0]
    ?.trim();
  if (!host) return null;
  // Prefer forwarded proto; fall back from request URL; default http for local LAN.
  const scheme =
    (req.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim() ||
    (originOf(req.url)?.startsWith('https:') ? 'https' : 'http');
  return originOf(`${scheme}://${host}`);
}

function allowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();
  const app = originOf(resolveAppOrigin());
  if (app) allowed.add(app);
  const requestOrigin = originOf(req.url);
  if (requestOrigin) allowed.add(requestOrigin);
  // LAN / hostname bind: browser Origin is http://10.x.x.x:port but req.url may be localhost.
  const hostOrigin = hostHeaderOrigin(req);
  if (hostOrigin) allowed.add(hostOrigin);
  return allowed;
}

/**
 * CSRF guard for cookie-authenticated mutations.
 * Bearer-token requests skip (no cookie CSRF surface).
 * Otherwise Origin (preferred) or Referer must match the app origin or this request's host.
 */
export function assertSameOriginMutation(req: Request): NextResponse | null {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) return null;

  const allowed = allowedOrigins(req);
  if (allowed.size === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const originHeader = req.headers.get('Origin');
  if (originHeader) {
    const got = originOf(originHeader);
    if (got && allowed.has(got)) return null;
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const referer = req.headers.get('Referer');
  if (referer) {
    const got = originOf(referer);
    if (got && allowed.has(got)) return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
