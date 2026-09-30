import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  buildArcpProvisionCsv,
  fetchArcpProvisionAggregates,
  fetchArcpProvisionCategoryAggregates,
  fetchArcpProvisionDetail,
  fetchArcpProvisionOptions,
  fetchArcpProvisionSummary,
  parseArcpProvisionFilters,
} from '@/modules/arcp-provision/server/query';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'arcp_provision' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'aggregates';
    const format = searchParams.get('format');
    const scope = {
      isHod: auth.security.isHod,
      assignedOffices: auth.security.assignedOffices,
    };
    const filters = parseArcpProvisionFilters(searchParams, scope);

    if (mode === 'options') {
      const options = await fetchArcpProvisionOptions(filters);
      return NextResponse.json(options);
    }

    if (format === 'csv') {
      const [aggregates, detail] = await Promise.all([
        fetchArcpProvisionAggregates(filters),
        fetchArcpProvisionDetail(filters, { limit: 50_000, offset: 0, lineKind: 'all' }),
      ]);
      const csv = buildArcpProvisionCsv(aggregates, detail.rows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="arcp-provision.csv"',
        },
      });
    }

    if (mode === 'summary') {
      const summary = await fetchArcpProvisionSummary(filters);
      return NextResponse.json(summary);
    }

    if (mode === 'category-aggregates') {
      const aggregates = await fetchArcpProvisionCategoryAggregates(filters);
      return NextResponse.json({ aggregates });
    }

    if (mode === 'detail') {
      const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(500, Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50));
      const lineKindParam = searchParams.get('lineKind');
      const lineKind =
        lineKindParam === 'travel'
          ? ('travel' as const)
          : lineKindParam === 'all'
            ? ('all' as const)
            : ('service' as const);
      const detail = await fetchArcpProvisionDetail(filters, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        lineKind,
      });
      return NextResponse.json({ ...detail, page, pageSize, lineKind });
    }

    const aggregates = await fetchArcpProvisionAggregates(filters);
    return NextResponse.json({ aggregates });
  } catch (err) {
    console.error('[arcp-provision]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
