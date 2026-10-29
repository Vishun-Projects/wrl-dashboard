import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { formatLocalDate } from '@/lib/dates/local-date';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { parseCallTypes, queryOpsKpis } from '@/sql/read-model/summary';

export function resolveOpsPeriod(period: string | null): {
  startDate: string;
  endDate: string;
  period: 'month' | 'year' | 'all';
} {
  const now = new Date();
  const endDate = formatLocalDate(now);
  const key = (period ?? 'month').toLowerCase();
  if (key === 'year') {
    return {
      period: 'year',
      startDate: formatLocalDate(new Date(now.getFullYear(), 0, 1)),
      endDate,
    };
  }
  if (key === 'all') {
    return { period: 'all', startDate: '2000-01-01', endDate };
  }
  return {
    period: 'month',
    startDate: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate,
  };
}

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
        { error: 'Ops KPIs require READ_SUMMARY_FROM=postgres.' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const range = resolveOpsPeriod(searchParams.get('period'));
    const callTypes = parseCallTypes(searchParams.get('callTypes'));

    const kpis = await queryOpsKpis({
      startDate: range.startDate,
      endDate: range.endDate,
      callTypes: callTypes.length ? callTypes : undefined,
      assignedOffices: security.assignedOffices.map(String),
      isHod: security.isHod,
    });
    const syncMeta = await getSyncMeta();

    return NextResponse.json({
      ...kpis,
      period: range.period,
      callTypesFilter: callTypes,
      syncMeta,
      readSource: 'postgres',
    });
  } catch (err: unknown) {
    console.error('Ops KPIs Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
