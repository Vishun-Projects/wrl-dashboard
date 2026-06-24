import { NextResponse } from 'next/server';
import { getSessionUserId, getUserInfoById } from '@/lib/auth/session';

type CachedMe = {
  expiresAt: number;
  payload: Awaited<ReturnType<typeof getUserInfoById>>;
};

const meCache = new Map<string, CachedMe>();
const ME_CACHE_TTL_MS = 15_000;

export async function GET() {
  const startedAt = performance.now();
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cached = meCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now && cached.payload) {
      const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
      const cacheAgeSec = Math.max(0, Math.floor((now - (cached.expiresAt - ME_CACHE_TTL_MS)) / 1000));
      return NextResponse.json(cached.payload, {
        headers: {
          'Cache-Control': 'private, max-age=15',
          'X-Cache': 'HIT',
          'X-Cache-Age': String(cacheAgeSec),
          'Server-Timing': `authme;dur=${elapsed};desc="cache-hit"`,
        },
      });
    }

    const userInfo = await getUserInfoById(userId);
    if (!userInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    meCache.set(userId, {
      payload: userInfo,
      expiresAt: now + ME_CACHE_TTL_MS,
    });

    const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
    return NextResponse.json(userInfo, {
      headers: {
        'Cache-Control': 'private, max-age=15',
        'X-Cache': 'MISS',
        'X-Cache-Age': '0',
        'Server-Timing': `authme;dur=${elapsed};desc="cache-miss"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load profile';
    console.error('[api/auth/me]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
 