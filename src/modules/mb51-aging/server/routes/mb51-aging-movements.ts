import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { fetchMb51MovementsPage } from '@/modules/mb51-aging/server/snapshot-read';

export const runtime = 'nodejs';
export const maxDuration = 120;

function csvList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo = sp.get('dateTo');
    const offsetRaw = sp.get('offset');
    return NextResponse.json(
      await fetchMb51MovementsPage({
        afterSeq: Number(sp.get('afterSeq') ?? -1),
        offset: offsetRaw != null && offsetRaw !== '' ? Number(offsetRaw) : undefined,
        limit: Number(sp.get('limit') || 100),
        dateFrom: dateFrom != null && dateFrom !== '' ? Number(dateFrom) : null,
        dateTo: dateTo != null && dateTo !== '' ? Number(dateTo) : null,
        plants: csvList(sp.get('plants')),
        vendors: csvList(sp.get('vendors')),
        groups: csvList(sp.get('groups')),
        materials: csvList(sp.get('materials')),
        movements: csvList(sp.get('movements')),
        q: sp.get('q') || '',
      })
    );
  } catch (err) {
    console.error('[mb51-aging movements]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
