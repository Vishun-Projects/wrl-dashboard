import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { fetchMb51Meta } from '@/modules/mb51-aging/server/snapshot-read';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;
    return NextResponse.json(await fetchMb51Meta());
  } catch (err) {
    console.error('[mb51-aging meta]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
