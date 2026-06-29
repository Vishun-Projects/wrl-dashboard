import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { loadBatchFileBytes } from '@/lib/mis-client-import/batch-file';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

type RouteContext = { params: Promise<{ batchId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const { batchId } = await context.params;
    if (!batchId?.trim()) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const { buffer, fileName, contentType, reconstructed } = await loadBatchFileBytes(batchId);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
        'Content-Length': String(buffer.length),
        ...(reconstructed ? { 'X-Import-File-Reconstructed': '1' } : {}),
      },
    });
  } catch (err: unknown) {
    console.error('MIS client import download error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
