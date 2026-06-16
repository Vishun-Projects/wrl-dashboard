import { NextResponse } from 'next/server';
import { getUserInfo } from '@/lib/auth/session';

type CachedMe = {
  expiresAt: number;
  payload: Awaited<ReturnType<typeof getUserInfo>>;
};

const meCache = new Map<string, CachedMe>();
const ME_CACHE_TTL_MS = 5_000;

export async function GET() {
  try {
    const userInfo = await getUserInfo();
    if (!userInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cached = meCache.get(userInfo.id);
    const now = Date.now();
    if (cached && cached.expiresAt > now && cached.payload) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': 'private, max-age=5' },
      });
    }

    meCache.set(userInfo.id, {
      payload: userInfo,
      expiresAt: now + ME_CACHE_TTL_MS,
    });

    return NextResponse.json(userInfo, {
      headers: { 'Cache-Control': 'private, max-age=5' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load profile';
    console.error('[api/auth/me]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
