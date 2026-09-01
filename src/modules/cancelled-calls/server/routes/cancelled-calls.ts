import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { buildCancelledCallsCsvStream } from '@/modules/cancelled-calls/server/csv-export';
import {
  fetchCancelledCallsFilterOptions,
  fetchCancelledCallsRows,
  fetchCancelledCallsSummary,
  parseCancelledCallsFilters,
} from '@/modules/cancelled-calls/server/query';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'cancelled_calls' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'rows';
    const format = searchParams.get('format');
    const scope = {
      isHod: auth.security.isHod,
      assignedOffices: auth.security.assignedOffices,
    };

    if (mode === 'options') {
      const { startDate, endDate } = parseCancelledCallsFilters(searchParams);
      const options = await fetchCancelledCallsFilterOptions({
        startDate,
        endDate,
        ...scope,
      });
      return NextResponse.json(options);
    }

    const filters: Parameters<typeof fetchCancelledCallsRows>[0] = {
      ...parseCancelledCallsFilters(searchParams),
      ...scope,
    };

    if (format === 'csv') {
      return buildCancelledCallsCsvStream(filters);
    }

    if (mode === 'summary') {
      const summary = await fetchCancelledCallsSummary(filters);
      return NextResponse.json(summary);
    }

    const rows = await fetchCancelledCallsRows(filters);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[cancelled-calls]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
