import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { listActiveSources, loadSourceConfigByCode, upsertSourceConfig } from '@/features/mis-import/lib/config';
import { canUploadClientMis } from '@/features/mis-import/lib/upload-access';
import type { SourceConfigPayload } from '@/features/mis-import/lib/config';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { logAction } from '@/lib/security/audit';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    if (code) {
      const config = await loadSourceConfigByCode(code);
      if (!config) return NextResponse.json({ error: 'Source not found' }, { status: 404 });
      return NextResponse.json({ config });
    }

    const sources = await listActiveSources();
    return NextResponse.json({ sources });
  } catch (err: unknown) {
    console.error('MIS client sources GET error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    const body = (await req.json()) as SourceConfigPayload;
    const config = await upsertSourceConfig(body);
    await logAction({
      request: req,
      action: 'import.mis_client.source.create',
      actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'mis_client_source', id: config.code, label: config.name ?? config.code },
      summary: `Created MIS import source (${config.code})`,
    });
    return NextResponse.json({ config });
  } catch (err: unknown) {
    console.error('MIS client sources POST error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
