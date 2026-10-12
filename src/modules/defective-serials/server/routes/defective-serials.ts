import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  fetchDefectiveSerialsOptions,
  fetchDefectiveSerialsRows,
  parseDefectiveSerialsFilters,
} from '@/modules/defective-serials/server/query';
import { buildDefectiveSerialsCsvStream } from '@/modules/defective-serials/server/csv-export';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'defective_serials' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const filters = {
      ...parseDefectiveSerialsFilters(searchParams),
      isHod: auth.security.isHod,
      assignedOffices: auth.security.assignedOffices,
    };

    if (searchParams.get('mode') === 'options') {
      const options = await fetchDefectiveSerialsOptions({
        startDate: filters.startDate,
        endDate: filters.endDate,
        isHod: filters.isHod,
        assignedOffices: filters.assignedOffices,
      });
      return NextResponse.json(options);
    }

    if (searchParams.get('format') === 'csv') {
      return buildDefectiveSerialsCsvStream(filters);
    }

    const rows = await fetchDefectiveSerialsRows(filters);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[defective-serials]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
