import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { DEFAULT_PARAM_HASH } from '@/modules/mb51-aging/server/fifo-from-db';
import { fetchMb51AggPage } from '@/modules/mb51-aging/server/snapshot-read';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const sortDirRaw = Number(sp.get('sortDir') || -1);
    return NextResponse.json(
      await fetchMb51AggPage({
        paramHash: sp.get('paramHash')?.trim() || DEFAULT_PARAM_HASH,
        page: Number(sp.get('page') || 1),
        pageSize: Number(sp.get('pageSize') || 100),
        q: sp.get('q') || '',
        sort: sp.get('sort') || 'total',
        sortDir: sortDirRaw >= 0 ? 1 : -1,
      })
    );
  } catch (err) {
    console.error('[mb51-aging agg]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
