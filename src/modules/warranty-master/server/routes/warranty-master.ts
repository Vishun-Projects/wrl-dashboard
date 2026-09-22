import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { gzippedCsvPayload } from '@/lib/net/csv-gzip-response';
import {
  fetchWarrantyMasterFgLines,
  fetchWarrantyMasterMeta,
  fetchWarrantyMasterRowDetail,
  fetchWarrantyMasterRows,
  fetchWarrantyMasterSerials,
  countWarrantyMasterSerials,
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
      const stamp = new Date().toISOString().slice(0, 10);
      const csv = await runWarrantyMasterCsvExport(params);
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

    if (mode === 'serials') {
      const customerKey = searchParams.get('customerKey') ?? undefined;
      const customerSubgroup = searchParams.get('customerSubgroup') ?? undefined;
      const groupKey = searchParams.get('groupKey') ?? undefined;
      const rowWarrantyMonthsRaw = searchParams.get('rowWarrantyMonths');
      const rowWarrantyMonths = rowWarrantyMonthsRaw ? Number(rowWarrantyMonthsRaw) : undefined;
      const limitRaw = searchParams.get('limit');
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const offsetRaw = searchParams.get('offset');
      const offset = offsetRaw ? Number(offsetRaw) : undefined;

      const serialParams = {
        ...params,
        customerKey,
        customerSubgroup,
        groupKey,
        rowWarrantyMonths,
      };
      const [serials, total] = await Promise.all([
        fetchWarrantyMasterSerials({ ...serialParams, limit, offset }),
        countWarrantyMasterSerials(serialParams),
      ]);
      return NextResponse.json({ serials, rows: serials, total });
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
