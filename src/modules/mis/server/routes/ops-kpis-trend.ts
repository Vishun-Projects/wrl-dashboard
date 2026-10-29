import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import { parseCallTypes } from '@/sql/read-model/summary';
import { queryOpsStatusTrend } from '@/sql/read-model/ops-status-trend';
import { resolveOpsPeriod } from '@/modules/mis/server/routes/ops-kpis';
import { yesterdayIst } from '@/lib/dates/local-date';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      shared: true,
    });
    if (!auth.ok) return auth.response;
    const { security } = auth;

    if (!readSummaryFromPostgres()) {
      return NextResponse.json(
        { error: 'Ops KPI trends require READ_SUMMARY_FROM=postgres.' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const range = resolveOpsPeriod(searchParams.get('period'));
    const callTypes = parseCallTypes(searchParams.get('callTypes'));
    // Incomplete today — seal/chart through yesterday IST only.
    const yesterday = yesterdayIst();
    const endDate = range.endDate > yesterday ? yesterday : range.endDate;
    const trend =
      endDate < range.startDate
        ? { days: [], callTypes: [], topTypes: [] }
        : await queryOpsStatusTrend({
            startDate: range.startDate,
            endDate,
            callTypes: callTypes.length ? callTypes : undefined,
            // Filtered selection: return every selected type so the panel can grow with rows.
            topCallTypes: callTypes.length ? Math.max(callTypes.length, 8) : 12,
            assignedOffices: security.assignedOffices.map(String),
            isHod: security.isHod,
          });

    return NextResponse.json({
      period: range.period,
      startDate: range.startDate,
      endDate,
      callTypesFilter: callTypes,
      ...trend,
      readSource: 'postgres',
    });
  } catch (err: unknown) {
    console.error('Ops KPI trend Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
