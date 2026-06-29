import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import {
  assembleAndProcessUpload,
  purgeStaleUploadChunks,
  storeUploadChunk,
} from '@/lib/mis-client-import/upload-chunks';
import { MIS_UPLOAD_CHUNK_BYTES } from '@/lib/mis-client-import/upload-chunk-constants';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    void purgeStaleUploadChunks().catch(() => {});

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          error: `Chunk too large — keep each part under ${Math.floor(MIS_UPLOAD_CHUNK_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 413 }
      );
    }

    const uploadId = String(formData.get('uploadId') ?? '').trim();
    const chunkIndex = Number(formData.get('chunkIndex'));
    const chunkTotal = Number(formData.get('chunkTotal'));
    const sourceCode = String(formData.get('sourceCode') ?? '').trim().toLowerCase();
    const fileName = String(formData.get('fileName') ?? '').trim();
    const chunk = formData.get('chunk');

    if (!uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkTotal)) {
      return NextResponse.json({ error: 'uploadId, chunkIndex, chunkTotal are required' }, { status: 400 });
    }
    if (chunkTotal < 1 || chunkIndex < 0 || chunkIndex >= chunkTotal) {
      return NextResponse.json({ error: 'Invalid chunk index' }, { status: 400 });
    }
    if (!sourceCode || !fileName) {
      return NextResponse.json({ error: 'sourceCode and fileName are required' }, { status: 400 });
    }
    if (!(chunk instanceof File)) {
      return NextResponse.json({ error: 'chunk is required' }, { status: 400 });
    }
    if (chunk.size > MIS_UPLOAD_CHUNK_BYTES) {
      return NextResponse.json({ error: 'Chunk exceeds size limit' }, { status: 413 });
    }

    const buffer = Buffer.from(await chunk.arrayBuffer());
    await storeUploadChunk({
      uploadId,
      chunkIndex,
      chunkTotal,
      sourceCode,
      fileName,
      uploadedBy: auth.userId,
      data: buffer,
    });

    if (chunkIndex < chunkTotal - 1) {
      return NextResponse.json({
        uploadId,
        chunkIndex,
        chunkTotal,
        complete: false,
      });
    }

    const result = await assembleAndProcessUpload(uploadId, auth.userId);
    return NextResponse.json({ ...result.body, complete: true }, { status: result.status });
  } catch (err: unknown) {
    console.error('MIS client import chunk upload error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
