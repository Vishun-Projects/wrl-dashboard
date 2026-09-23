import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  buildWarrantyComparisonCsvStream,
  fetchWarrantyComparisonOptions,
  fetchWarrantyComparisonRows,
  fetchWarrantyComparisonSummary,
  parseWarrantyComparisonFilters,
} from '../query';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'warranty_master' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'rows';
    const format = searchParams.get('format');
    const scope = {
      isHod: auth.security.isHod,
      assignedOffices: auth.security.assignedOffices,
    };

    const filters = {
      ...parseWarrantyComparisonFilters(searchParams),
      ...scope,
    };

    if (format === 'csv') {
      return buildWarrantyComparisonCsvStream(filters);
    }

    if (mode === 'options') {
      const options = await fetchWarrantyComparisonOptions(filters);
      return NextResponse.json(options);
    }

    if (mode === 'summary') {
      const summary = await fetchWarrantyComparisonSummary(filters);
      return NextResponse.json(summary);
    }

    const rowsResponse = await fetchWarrantyComparisonRows(filters);
    return NextResponse.json(rowsResponse);
  } catch (err) {
    console.error('[warranty-comparison-api]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
