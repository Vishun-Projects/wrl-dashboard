import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { queryOpsKpis } from '@/sql/read-model/summary';

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

    const kpis = await queryOpsKpis({
      assignedOffices: security.assignedOffices.map(String),
      isHod: security.isHod,
    });
    const syncMeta = await getSyncMeta();

    return NextResponse.json({
      ...kpis,
      syncMeta,
      readSource: 'postgres',
    });
  } catch (err: unknown) {
    console.error('Ops KPIs Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
