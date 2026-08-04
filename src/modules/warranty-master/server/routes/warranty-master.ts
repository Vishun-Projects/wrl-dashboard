import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { gzippedCsvPayload } from '@/lib/net/csv-gzip-response';
import {
  fetchWarrantyMasterFgLines,
  fetchWarrantyMasterMeta,
  fetchWarrantyMasterRowDetail,
  fetchWarrantyMasterRows,
  parseWarrantyMasterDetailParams,
  parseWarrantyMasterParams,
  runWarrantyMasterCsvExport,
  summarizeWarrantyMasterRows,
} from '@/modules/warranty-master/server';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'warranty_master' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const params = parseWarrantyMasterParams(searchParams);
    const mode = searchParams.get('mode') ?? 'rows';
    const format = searchParams.get('format');

    if (format === 'csv') {
      const csv = await runWarrantyMasterCsvExport(params);
      const stamp = new Date().toISOString().slice(0, 10);
      const { body, headers } = gzippedCsvPayload(
        csv,
        `warranty-master-${stamp}.csv`,
        req.headers.get('accept-encoding')
      );
      return new NextResponse(body, { headers });
    }

    if (mode === 'meta') {
      const meta = await fetchWarrantyMasterMeta();
      return NextResponse.json(meta);
    }

    if (mode === 'fgLines') {
      const fgLines = await fetchWarrantyMasterFgLines();
      const meta = await fetchWarrantyMasterMeta();
      return NextResponse.json({ fgLines, meta });
    }

    if (mode === 'detail') {
      const parsed = parseWarrantyMasterDetailParams(searchParams);
      if (parsed.error || !parsed.params) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const detailRows = await fetchWarrantyMasterRowDetail(parsed.params);
      return NextResponse.json({ rows: detailRows });
    }

    const rows = await fetchWarrantyMasterRows(params);
    const summary = summarizeWarrantyMasterRows(rows);
    return NextResponse.json({ rows, summary });
  } catch (err) {
    console.error('[warranty-master]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
