import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { deleteImportFile } from '@/modules/mis/client-import/services/file-store';
import {
  importFileRetentionTooltip,
  isImportFilePastRetention,
} from '@/modules/mis/client-import/services/file-retention';
import { deleteImportBatch } from '@/modules/mis/client-import/services/store';
import { canDeleteClientMis } from '@/modules/mis/client-import/services/upload-access';
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

    const { uploadedAt, latestUploadAt } = await withAppClient(async (client) => {
      const res = await client.query<{ created_at: Date; latest_upload_at: Date }>(
        `
        SELECT b.created_at,
               (SELECT MAX(created_at) FROM mis_client_import_batches WHERE source_id = b.source_id AND status = 'completed') AS latest_upload_at
        FROM mis_client_import_batches b
        WHERE b.batch_id = $1::uuid
        `,
        [batchId]
      );
      return {
        uploadedAt: res.rows[0]?.created_at ?? null,
        latestUploadAt: res.rows[0]?.latest_upload_at ?? null,
      };
    });
    if (!uploadedAt) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }
    
    // Retention is relative to the latest file uploaded for that source
    const nowMs = latestUploadAt ? latestUploadAt.getTime() : Date.now();
    if (isImportFilePastRetention(uploadedAt, undefined, nowMs)) {
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
