import { NextRequest, NextResponse } from 'next/server';
import { resolveBearerReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import {
  parseCallTypes,
  parseCsvFilter,
  querySummaryDashboard,
} from '@/lib/read-model/queries/summary';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { postQuery } from '@/lib/db/proxy';
import {
  appendCallTypeFilter,
  appendOfficeSecurityFilter,
  buildCorpusFieldsSql,
  buildCorpusTableName,
  enrichTrhcallBranchFranchisee,
  TRHCALLS_EXCLUDE_TRANSFERRED,
} from '@/lib/trhcalls/query';
import { deriveSummaryDashboard } from '@/lib/report/summary-derive';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveBearerReportSecurity(req.headers.get('Authorization'));
    if (!auth.ok) return auth.response;
    const { security } = auth;

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf');

    const assignedOffices = security.assignedOffices.map(String);
    const isHod = security.isHod;

    if (readSummaryFromPostgres()) {
      const result = await querySummaryDashboard({
        startDate,
        endDate,
        agingAsOf: agingAsOf || undefined,
        officeIds: parseCsvFilter(officeId),
        callTypes: parseCallTypes(callType),
        assignedOffices,
        isHod,
      });
      const syncMeta = await getSyncMeta();
      return NextResponse.json({ ...result, syncMeta, readSource: 'postgres' });
    }

    let condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
    condition = appendCallTypeFilter(condition, callType);
    condition = appendOfficeSecurityFilter(condition, isHod, assignedOffices);

    if (startDate) {
      condition += ` AND tc.dtrndate >= '${startDate.replace(/'/g, "''")}'`;
    }
    if (endDate) {
      condition += ` AND tc.dtrndate <= '${endDate.replace(/'/g, "''")} 23:59:59'`;
    }

    const rawRes = await postQuery({
      fields: buildCorpusFieldsSql(),
      tableName: buildCorpusTableName({ startDate, endDate }),
      condition,
      orderBy: 'tc.dtrndate DESC',
    });

    const rows = (rawRes.data || []).map((row: Record<string, unknown>) =>
      enrichTrhcallBranchFranchisee(row)
    );

    const agingStr =
      agingAsOf && !Number.isNaN(new Date(agingAsOf).getTime())
        ? new Date(agingAsOf).toISOString().split('T')[0]
        : agingAsOf || undefined;

    const result = deriveSummaryDashboard(rows, {
      agingAsOf: agingStr,
      endDate: endDate || undefined,
      officeIdsParam: officeId || 'All',
      callTypesParam: callType || 'All',
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Report Summary Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
