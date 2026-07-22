import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { loadBatchFileBytes } from '@/features/mis-import/lib/batch-file';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

type RouteContext = { params: Promise<{ batchId: string }> };

function parseBytesRange(
  rangeHeader: string | null,
  total: number
): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=') || total <= 0) return null;
  const spec = rangeHeader.slice('bytes='.length).trim();
  // Single range only: bytes=START-END or bytes=START-
  if (spec.includes(',')) return null;
  const [startRaw, endRaw] = spec.split('-', 2);
  let start = startRaw === '' ? NaN : Number(startRaw);
  let end = endRaw === '' || endRaw == null ? total - 1 : Number(endRaw);
  if (!Number.isFinite(start) && Number.isFinite(end)) {
    // suffix: bytes=-N
    const suffix = end;
    if (suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  }
  if (!Number.isFinite(start) || start < 0) return null;
  if (!Number.isFinite(end) || end >= total) end = total - 1;
  if (start > end) return null;
  return { start, end };
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', shared: true });
    if (!auth.ok) return auth.response;

    const { batchId } = await context.params;
    if (!batchId?.trim()) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const { buffer, fileName, contentType, reconstructed } = await loadBatchFileBytes(batchId);
    const total = buffer.byteLength;
    const baseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      ...(reconstructed ? { 'X-Import-File-Reconstructed': '1' } : {}),
    };

    // Range resume only for stored bytes (not reconstructed on the fly).
    if (!reconstructed) {
      baseHeaders['Accept-Ranges'] = 'bytes';
      const range = parseBytesRange(req.headers.get('range'), total);
      if (range) {
        const slice = buffer.subarray(range.start, range.end + 1);
        return new NextResponse(new Uint8Array(slice), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(slice.byteLength),
            'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
          },
        });
      }
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...baseHeaders,
        'Content-Length': String(total),
      },
    });
  } catch (err: unknown) {
    console.error('MIS client import download error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
