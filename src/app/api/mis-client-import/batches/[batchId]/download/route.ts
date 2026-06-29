import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { readImportFile } from '@/lib/mis-client-import/file-store';
import { withAppClient } from '@/lib/read-model/db';
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

    const batch = await withAppClient(async (client) => {
      const res = await client.query<{
        file_name: string;
        stored_file_path: string | null;
      }>(
        `
        SELECT b.file_name, b.stored_file_path
        FROM mis_client_import_batches b
        WHERE b.batch_id = $1::uuid AND b.status = 'completed'
        LIMIT 1
        `,
        [batchId]
      );
      return res.rows[0] ?? null;
    });

    if (!batch?.stored_file_path) {
      return NextResponse.json({ error: 'File not found for this batch' }, { status: 404 });
    }

    const buffer = await readImportFile(batch.stored_file_path);
    const fileName = batch.file_name || 'import.dat';
    const contentType = fileName.toLowerCase().endsWith('.csv')
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: unknown) {
    console.error('MIS client import download error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
