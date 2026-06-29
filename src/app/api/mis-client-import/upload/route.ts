import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { processClientMisUpload } from '@/lib/mis-client-import/process-upload';
import {
  formatMisUploadTooLargeMessage,
  MIS_CLIENT_MAX_UPLOAD_BYTES,
} from '@/lib/mis-client-import/upload-limits';
import { canUploadClientMis } from '@/lib/mis-client-import/upload-access';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const userAuth = await loadUserAuth(auth.userId);
    const email = userAuth?.profile?.email;
    if (!canUploadClientMis(email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (err: unknown) {
      const contentLength = Number(req.headers.get('content-length') ?? 0);
      if (contentLength > MIS_CLIENT_MAX_UPLOAD_BYTES * 0.9) {
        return NextResponse.json(
          {
            error:
              'Upload body was truncated (file may exceed server buffer limit). ' +
              'Restart the dev server after config changes, or contact admin.',
          },
          { status: 413 }
        );
      }
      throw err;
    }
    const sourceCode = String(formData.get('sourceCode') ?? '').trim().toLowerCase();
    const file = formData.get('file');

    if (!sourceCode) {
      return NextResponse.json({ error: 'sourceCode is required' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (file.size > MIS_CLIENT_MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: formatMisUploadTooLargeMessage(file.size) },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await processClientMisUpload({
      sourceCode,
      fileName: file.name,
      buffer,
      uploadedBy: auth.userId,
    });

    if (!result.batchId) {
      return NextResponse.json(
        {
          error: 'Import failed — no valid rows',
          errorCount: result.errorCount,
          errors: result.errors,
          warnings: result.warnings,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      batchId: result.batchId,
      rowCount: result.rowCount,
      errorCount: result.errorCount,
      errors: result.errors,
      warnings: result.warnings,
      filterStart: result.filterStart,
      filterEnd: result.filterEnd,
    });
  } catch (err: unknown) {
    console.error('MIS client import error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
