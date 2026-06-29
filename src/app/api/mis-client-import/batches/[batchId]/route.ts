import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { deleteImportFile } from '@/lib/mis-client-import/file-store';
import { deleteImportBatch } from '@/lib/mis-client-import/store';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

type RouteContext = { params: Promise<{ batchId: string }> };

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const userAuth = await loadUserAuth(auth.userId);
    const email = userAuth?.profile?.email;
    if (!canUploadClientMis(email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { batchId } = await context.params;
    if (!batchId?.trim()) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const result = await deleteImportBatch(batchId);
    if (!result.deleted) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    await deleteImportFile(result.storedFilePath);

    return NextResponse.json({ deleted: true, batchId });
  } catch (err: unknown) {
    console.error('MIS client import delete error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
