import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import {
  handleMisClientUploadChunkFormData,
  handleMisClientUploadChunkStatus,
} from '@/lib/mis-client-import/upload-chunk-http';
import { MIS_UPLOAD_CHUNK_BYTES_MAX } from '@/lib/mis-client-import/upload-chunk-constants';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const uploadId = req.nextUrl.searchParams.get('uploadId')?.trim() ?? '';
    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
    }

    const result = await handleMisClientUploadChunkStatus({
      userId: auth.userId,
      uploadId,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('MIS client import chunk status error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          error: `Chunk too large — keep each part under ${Math.floor(MIS_UPLOAD_CHUNK_BYTES_MAX / (1024 * 1024))} MB.`,
        },
        { status: 413 }
      );
    }

    const result = await handleMisClientUploadChunkFormData({
      userId: auth.userId,
      formData,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('MIS client import chunk upload error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
