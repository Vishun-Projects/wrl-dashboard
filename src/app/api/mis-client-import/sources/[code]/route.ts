import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { loadSourceConfigByCode, upsertSourceConfig } from '@/features/mis-import/services/config';
import type { SourceConfigPayload } from '@/features/mis-import/services/config';
import { canUploadClientMis } from '@/features/mis-import/services/upload-access';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { logAction } from '@/lib/security/audit';

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
    const actor = {
      userId: auth.userId,
      email: userAuth?.profile?.email ?? null,
      name: userAuth?.profile?.name ?? null,
    };
    if (!canUploadClientMis(userAuth?.permissions ?? [])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { code } = await context.params;
    const body = (await req.json()) as Omit<SourceConfigPayload, 'code'>;
    const config = await upsertSourceConfig({ ...body, code });
    await logAction({
      request: req,
      action: 'import.mis_client.source.update',
      actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'mis_client_source', id: config.code, label: config.name ?? config.code },
      summary: `Updated MIS import source (${config.code})`,
    });
    return NextResponse.json({ config });
  } catch (err: unknown) {
    console.error('MIS client source PUT error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
