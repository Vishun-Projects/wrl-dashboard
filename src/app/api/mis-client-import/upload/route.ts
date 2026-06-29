import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { handleMisClientUploadFormData } from '@/lib/mis-client-import/upload-http';
import {
  formatMisVercelUploadTooLargeMessage,
  MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES,
} from '@/lib/mis-client-import/upload-limits';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (err: unknown) {
      const contentLength = Number(req.headers.get('content-length') ?? 0);
      if (contentLength > MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES * 0.9 || process.env.VERCEL) {
        return NextResponse.json(
          {
            error: formatMisVercelUploadTooLargeMessage(contentLength || MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES),
          },
          { status: 413 }
        );
      }
      throw err;
    }

    const result = await handleMisClientUploadFormData({
      userId: auth.userId,
      formData,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('MIS client import error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
