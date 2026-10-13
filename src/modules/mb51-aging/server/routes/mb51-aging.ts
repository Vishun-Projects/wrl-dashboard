import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  fetchLatestMb51AgingData,
  saveMb51AgingImport,
} from '@/modules/mb51-aging/server/store';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;

    const data = await fetchLatestMb51AgingData();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[mb51-aging GET]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mb51_aging' });
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload: rows array required' },
        { status: 400 }
      );
    }

    const fileName = String(body.fileName || 'MB51_Export.xlsx').trim();
    const rows = body.rows as Mb51AgingMovement[];
    const replaceExisting = body.replaceExisting !== false;
    const importId =
      typeof body.importId === 'string' && body.importId.trim()
        ? body.importId.trim()
        : null;
    const seqOffset = Math.max(0, Number(body.seqOffset) || 0);
    const expectedTotal = Math.max(0, Number(body.expectedTotal) || 0) || undefined;

    const result = await saveMb51AgingImport({
      fileName,
      uploadedBy: auth.userId,
      rows,
      replaceExisting,
      importId,
      seqOffset,
      expectedTotal,
    });

    return NextResponse.json({
      success: true,
      import: result,
      // alias kept for older table-page clients that read `meta`
      meta: result,
    });
  } catch (err) {
    console.error('[mb51-aging POST]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
