import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { buildCallPartsCsvStream } from '@/modules/call-visits/server/csv-export';
import {
  fetchCallPartsOptions,
  fetchCallPartsRows,
  parseCallPartsFilters,
} from '@/modules/call-visits/server/query';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'call_visits' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const filters = {
      ...parseCallPartsFilters(searchParams),
      isHod: auth.security.isHod,
      assignedOffices: auth.security.assignedOffices,
    };

    if (searchParams.get('mode') === 'options') {
      return NextResponse.json(await fetchCallPartsOptions(filters));
    }
    if (searchParams.get('format') === 'csv') {
      return buildCallPartsCsvStream(filters);
    }
    return NextResponse.json(await fetchCallPartsRows(filters));
  } catch (err) {
    console.error('[call-visits]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
