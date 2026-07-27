import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt-core';
import { resolveUserIdFromSupabaseCookies } from '@/lib/auth/supabase-cookie';
import { requireSupabaseUser } from '@/lib/auth/server-user';

function routeGuards(request: NextRequest, hasUser: boolean): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname.startsWith('/login');
  const isAuthRecoveryPage =
    pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password');
  const isPublicRoute = isLoginPage || isAuthRecoveryPage || pathname === '/';
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');

  if (!hasUser && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Do not redirect /login → /report here: stale cookies + API 401 caused a reload loop.
  // Logged-in users on /login are handled client-side after /api/auth/me succeeds.

  if (hasUser && request.nextUrl.pathname === '/calls') {
    const url = request.nextUrl.clone();
    url.pathname = '/report';
    return NextResponse.redirect(url);
  }

  return null;
}

export async function updateSession(request: NextRequest) {
  if (isDevAuthBypass()) {
    const userId = await resolveUserIdFromSupabaseCookies(request);
    const guard = routeGuards(request, Boolean(userId));
    if (guard) return guard;
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach((cookie) => request.cookies.set(cookie.name, cookie.value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach((cookie) =>
            supabaseResponse.cookies.set(cookie.name, cookie.value, cookie.options)
          );
        },
      },
    }
  );

  const user = await requireSupabaseUser(supabase);
  const guard = routeGuards(request, Boolean(user));
  if (guard) return guard;

  return supabaseResponse;
}
