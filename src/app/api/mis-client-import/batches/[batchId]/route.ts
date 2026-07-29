import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { deleteImportFile } from '@/features/mis-import/lib/file-store';
import {
  importFileRetentionTooltip,
  isImportFilePastRetention,
} from '@/features/mis-import/lib/file-retention';
import { deleteImportBatch } from '@/features/mis-import/lib/store';
import { canDeleteClientMis } from '@/features/mis-import/lib/upload-access';
import { withAppClient } from '@/lib/read-model/db';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { logAction } from '@/lib/security/audit';

type RouteContext = { params: Promise<{ batchId: string }> };

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const userAuth = await loadUserAuth(auth.userId);
    if (!canDeleteClientMis(userAuth?.permissions ?? [])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { batchId } = await context.params;
    if (!batchId?.trim()) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const uploadedAt = await withAppClient(async (client) => {
      const res = await client.query<{ created_at: Date }>(
        `SELECT created_at FROM mis_client_import_batches WHERE batch_id = $1::uuid`,
        [batchId]
      );
      return res.rows[0]?.created_at ?? null;
    });
    if (!uploadedAt) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }
    if (isImportFilePastRetention(uploadedAt)) {
      return NextResponse.json({ error: importFileRetentionTooltip() }, { status: 403 });
    }

    const result = await deleteImportBatch(batchId);
    if (!result.deleted) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    await deleteImportFile(result.storedFilePath);

    await logAction({
      request: req,
      action: 'import.mis_client.delete',
      actor: {
        userId: auth.userId,
        email: userAuth?.profile?.email ?? null,
        name: userAuth?.profile?.name ?? null,
      },
      result: 'success',
      statusCode: 200,
      target: { type: 'mis_client_import_batch', id: batchId },
      summary: `Deleted MIS client import batch ${batchId}`,
    });

    return NextResponse.json({ deleted: true, batchId });
  } catch (err: unknown) {
    console.error('MIS client import delete error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
