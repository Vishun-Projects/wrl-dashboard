import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { loadSourceConfigByCode, upsertSourceConfig } from '@/lib/mis-client-import/config';
import type { SourceConfigPayload } from '@/lib/mis-client-import/config';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const config = await loadSourceConfigByCode(code);
    if (!config) return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    return NextResponse.json({ config });
  } catch (err: unknown) {
    console.error('MIS client source GET error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const userAuth = await loadUserAuth(auth.userId);
    if (!canUploadClientMis(userAuth?.permissions ?? [])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { code } = await context.params;
    const body = (await req.json()) as Omit<SourceConfigPayload, 'code'>;
    const config = await upsertSourceConfig({ ...body, code });
    return NextResponse.json({ config });
  } catch (err: unknown) {
    console.error('MIS client source PUT error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
