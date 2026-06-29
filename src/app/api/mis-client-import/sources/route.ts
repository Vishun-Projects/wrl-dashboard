import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { listActiveSources, loadSourceConfigByCode, upsertSourceConfig } from '@/lib/mis-client-import/config';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';
import type { SourceConfigPayload } from '@/lib/mis-client-import/config';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

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
    if (!canUploadClientMis(userAuth?.permissions ?? [])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await req.json()) as SourceConfigPayload;
    const config = await upsertSourceConfig(body);
    return NextResponse.json({ config });
  } catch (err: unknown) {
    console.error('MIS client sources POST error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
