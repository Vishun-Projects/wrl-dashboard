import { NextRequest, NextResponse } from 'next/server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  REJECTED_CALLS_CSV_CAP,
  buildRejectedCallsCsvResponse,
} from '@/modules/rejected-calls/server/csv';
import {
  fetchRejectedCallsForCsv,
  fetchRejectedCallsPage,
  fetchRejectedCallsRows,
  fetchRejectedCallsSummary,
  parseRejectedCallsFilters,
} from '@/modules/rejected-calls/server/query';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'rejected_calls' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const filters = {
      ...parseRejectedCallsFilters(searchParams),
      isHod: auth.security.isHod,
      assignedOffices: auth.security.assignedOffices,
    };

    if (searchParams.get('format') === 'csv') {
      const rows = await fetchRejectedCallsForCsv(filters, REJECTED_CALLS_CSV_CAP);
      return buildRejectedCallsCsvResponse(rows, filters.endDate);
    }

    const mode = searchParams.get('mode') ?? 'rows';
    if (mode === 'summary') {
      return NextResponse.json(await fetchRejectedCallsSummary(filters));
    }
    if (mode === 'full') {
      return NextResponse.json(await fetchRejectedCallsPage(filters));
    }
    return NextResponse.json(await fetchRejectedCallsRows(filters));
  } catch (err) {
    console.error('[rejected-calls]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
