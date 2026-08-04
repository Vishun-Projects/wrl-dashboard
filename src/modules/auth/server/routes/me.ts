import { NextResponse } from 'next/server';
import {
  getPortalSessionExpiry,
  getSessionUserId,
  getUserInfoById,
} from '@/lib/auth/session';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { getMeCache, setMeCache, ME_CACHE_TTL_MS } from '@/lib/auth/me-cache';
import { sessionExpiredJsonBody } from '@/lib/auth/session-policy';
import { cookies } from 'next/headers';
import { evaluatePortalSession } from '@/lib/auth/session-policy-server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';

export async function GET() {
  const startedAt = performance.now();
  try {
    const supabase = await createClient();
    const authUser = await requireSupabaseUser(supabase);
    if (authUser) {
      const cookieStore = await cookies();
      // JWT can still be valid after portal soft-timeout; expire session here before serving /me.
      const portal = evaluatePortalSession(cookieStore.getAll());
      if (!portal.ok) {
        return NextResponse.json(sessionExpiredJsonBody(), { status: 401 });
      }
    }

    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const portalExpiry = await getPortalSessionExpiry();

    const cached = getMeCache(userId);
    const now = Date.now();
    if (cached?.payload) {
      const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
      const cacheAgeSec = Math.max(
        0,
        Math.floor((now - (cached.expiresAt - ME_CACHE_TTL_MS)) / 1000)
      );
      return NextResponse.json(
        {
          ...cached.payload,
          sessionExpiresAt: portalExpiry.sessionExpiresAt,
        },
        {
          headers: {
            'Cache-Control': 'private, max-age=15',
            'X-Cache': 'HIT',
            'X-Cache-Age': String(cacheAgeSec),
            'Server-Timing': `authme;dur=${elapsed};desc="cache-hit"`,
          },
        }
      );
    }

    const userInfo = await getUserInfoById(userId);
    if (!userInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    setMeCache(userId, userInfo);

    const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
    return NextResponse.json(
      {
        ...userInfo,
        sessionExpiresAt: portalExpiry.sessionExpiresAt,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=15',
          'X-Cache': 'MISS',
          'X-Cache-Age': '0',
          'Server-Timing': `authme;dur=${elapsed};desc="cache-miss"`,
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load profile';
    console.error('[api/auth/me]', message);
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to load profile') }, { status: 500 });
  }
}
