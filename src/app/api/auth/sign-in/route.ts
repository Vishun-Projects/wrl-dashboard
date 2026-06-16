import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  isDbSignInAvailable,
  networkBlockedHint,
  signInViaDatabase,
} from '@/lib/auth/db-sign-in';
import { persistSessionCookies } from '@/lib/auth/persist-session-cookies';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';

type SignInBody = {
  email?: string;
  password?: string;
};

type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: unknown;
};

async function proxyGoTrueSignIn(email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase env is not configured');
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    /* HTML block page from firewall */
  }

  if (!res.ok) {
    const blocked = text.includes('Blocked site') || res.status === 403;
    const msg =
      (json?.error_description as string) ||
      (json?.msg as string) ||
      (json?.error as string) ||
      (blocked ? 'network_blocked' : `Auth failed (${res.status})`);
    return { ok: false as const, status: res.status, message: msg, blocked };
  }

  return { ok: true as const, session: json };
}

function parseProxySession(session: Record<string, unknown>): SessionPayload | null {
  if (!session.access_token || !session.refresh_token) return null;
  return {
    access_token: String(session.access_token),
    refresh_token: String(session.refresh_token),
    expires_in: session.expires_in as number | undefined,
    expires_at: session.expires_at as number | undefined,
    token_type: session.token_type as string | undefined,
    user: session.user,
  };
}

async function persistSession(sessionPayload: SessionPayload) {
  const cookieStore = await cookies();
  const cookieWriter = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookieStore.set(name, value, options);
      });
    },
  };

  // setSession() calls GoTrue getUser over HTTPS — fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE
  // when the self-hosted cert is untrusted or the host is blocked on the network.
  if (isDevAuthBypass()) {
    persistSessionCookies(cookieWriter, {
      ...sessionPayload,
      user:
        sessionPayload.user &&
        typeof sessionPayload.user === 'object' &&
        sessionPayload.user !== null &&
        'id' in sessionPayload.user
          ? {
              id: String((sessionPayload.user as { id: string }).id),
              email:
                'email' in sessionPayload.user
                  ? String((sessionPayload.user as { email?: string }).email ?? '')
                  : undefined,
            }
          : undefined,
    });
    return;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.setSession({
    access_token: sessionPayload.access_token,
    refresh_token: sessionPayload.refresh_token,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SignInBody;
    const email = body.email?.trim();
    const password = body.password ?? '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    let sessionPayload: SessionPayload | null = null;
    let proxyBlocked = false;

    // Dev-only: DB auth when GoTrue HTTPS is blocked on localhost.
    if (isDevAuthBypass() && isDbSignInAvailable()) {
      try {
        sessionPayload = await signInViaDatabase(email, password);
        if (!sessionPayload) {
          return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
        }
      } catch (dbErr: unknown) {
        const message = dbErr instanceof Error ? dbErr.message : 'Database sign-in failed';
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (!sessionPayload) {
      try {
        const proxy = await proxyGoTrueSignIn(email, password);
        if (proxy.ok && proxy.session) {
          sessionPayload = parseProxySession(proxy.session);
        } else if (proxy.ok === false) {
          proxyBlocked = proxy.blocked;
          if (proxy.message !== 'network_blocked') {
            return NextResponse.json(
              { error: proxy.message },
              { status: proxy.status === 401 ? 401 : 502 }
            );
          }
        }
      } catch {
        proxyBlocked = true;
      }
    }

    if (!sessionPayload) {
      return NextResponse.json(
        {
          error: proxyBlocked
            ? networkBlockedHint()
            : 'Sign-in failed. Check email/password or Supabase configuration.',
        },
        { status: 502 }
      );
    }

    await persistSession(sessionPayload);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sign-in failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
