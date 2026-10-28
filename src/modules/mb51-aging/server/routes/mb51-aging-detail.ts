import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { DEFAULT_PARAM_HASH } from '@/modules/mb51-aging/server/fifo-from-db';
import { fetchMb51Detail } from '@/modules/mb51-aging/server/snapshot-read';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => null);
    const groupKey = String(body?.groupKey || '').trim();
    if (!groupKey) {
      return NextResponse.json({ error: 'groupKey required' }, { status: 400 });
    }
    const bucketIdx = Number(body?.bucketIdx);
    const data = await fetchMb51Detail({
      paramHash: String(body?.paramHash || DEFAULT_PARAM_HASH),
      groupKey,
      bucketIdx: Number.isFinite(bucketIdx) ? bucketIdx : -1,
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error('[mb51-aging detail]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
