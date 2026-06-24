import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { hasPagePermission } from '@/lib/auth/page-access';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  fetchWarrantyMasterFgLines,
  fetchWarrantyMasterMeta,
  fetchWarrantyMasterRowDetail,
  fetchWarrantyMasterRows,
  parseWarrantyMasterDetailParams,
  parseWarrantyMasterParams,
  runWarrantyMasterCsvExport,
  summarizeWarrantyMasterRows,
} from '@/lib/warranty-master/server';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'warranty_master' });
    if (!auth.ok) return auth.response;
    const { userId } = auth;

    const permissions = await (prisma as any).getUserPermissions(userId);
    if (!hasPagePermission(permissions, 'page_warranty_master')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const params = parseWarrantyMasterParams(searchParams);
    const mode = searchParams.get('mode') ?? 'rows';
    const format = searchParams.get('format');

    if (format === 'csv') {
      const csv = await runWarrantyMasterCsvExport(params);
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="warranty-master-${stamp}.csv"`,
        },
      });
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
