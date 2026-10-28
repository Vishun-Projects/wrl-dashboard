import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { DEFAULT_PARAM_HASH } from '@/modules/mb51-aging/server/fifo-from-db';
import { fetchMb51Summary } from '@/modules/mb51-aging/server/snapshot-read';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    const paramHash =
      req.nextUrl.searchParams.get('paramHash')?.trim() || DEFAULT_PARAM_HASH;
    return NextResponse.json(await fetchMb51Summary(paramHash));
  } catch (err) {
    console.error('[mb51-aging summary]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
