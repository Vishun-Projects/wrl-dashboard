import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clearSessionCookies } from '@/lib/auth/persist-session-cookies';

export async function POST() {
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

  // Always clear httpOnly cookies first — GoTrue signOut can fail (TLS / key mismatch).
  try {
    clearSessionCookies(cookieWriter);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sign-out failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
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
    await supabase.auth.signOut();
  } catch {
    /* cookie clear above is enough for logout */
  }

  return NextResponse.json({ ok: true });
}
