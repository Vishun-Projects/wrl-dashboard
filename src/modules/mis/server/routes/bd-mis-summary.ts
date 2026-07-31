import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import {
  parseCallTypes,
  parseCsvFilter,
} from '@/sql/read-model/summary';
import {
  queryBdMisCrmCallTraceRows,
  queryBdMisCrmSummary,
} from '@/sql/read-model/bd-mis-summary';
import {
  queryClientAccountSummaryForBdMis,
  queryClientCallTraceRowsFiltered,
  queryClientCallTraceRowsForBdMis,
} from '@/modules/mis/client-import/services/aggregate';
import {
  buildBdMisRegionalRows,
  bdMisSourcesFromSelection,
  sumBdMisRegionalGrand,
} from '@/modules/mis/services/bd-mis-summary';
import { buildBdMisTraceRows } from '@/modules/mis/services/bd-mis-trace';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'bd_mis_summary',
    });
    if (!auth.ok) return auth.response;
    const { security } = auth;

    if (!readSummaryFromPostgres()) {
      return NextResponse.json(
        { error: 'BD MIS summary requires Postgres read model.' },
        { status: 501 }
      );
    }

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf');
    const includeCrm = searchParams.get('includeCrm') !== 'false';
    const includeTrace = searchParams.get('includeTrace') === 'true';
    const traceAlign = searchParams.get('traceAlign') === 'summary' ? 'summary' : 'bd_mis';
    const clientSources = (searchParams.get('clientSources') ?? 'coke,cadbury')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const assignedOffices = security.assignedOffices.map(String);
    const isHod = security.isHod;

    const queryParams = {
      startDate,
      endDate,
      agingAsOf: agingAsOf || undefined,
      officeIds: parseCsvFilter(officeId),
      callTypes: parseCallTypes(callType),
      assignedOffices,
      isHod,
    };

    const crm = await queryBdMisCrmSummary(queryParams);

    const clientAccountSummary = await queryClientAccountSummaryForBdMis({
      startDate,
      endDate,
      agingAsOf: agingAsOf || undefined,
      sourceCodes: clientSources,
    });

    const sources = bdMisSourcesFromSelection(includeCrm, clientSources);
    const regionalRows = buildBdMisRegionalRows({
      crmBranchSummary: crm.branchSummary,
      crmAccountSummary: crm.accountSummary,
      clientAccountSummary,
      sources,
    });
    const grand = sumBdMisRegionalGrand(regionalRows);
    const syncMeta = await getSyncMeta();

    const agingDate =
      agingAsOf || endDate || new Date().toISOString().slice(0, 10);

    let traceRows: ReturnType<typeof buildBdMisTraceRows> | undefined;
    if (includeTrace) {
      const useClientSnapshot = traceAlign === 'bd_mis';
      const [crmCallRows, clientCallRows] = await Promise.all([
        includeCrm ? queryBdMisCrmCallTraceRows(queryParams) : Promise.resolve([]),
        clientSources.length
          ? useClientSnapshot
            ? queryClientCallTraceRowsForBdMis({
                startDate,
                endDate,
                agingAsOf: agingAsOf || undefined,
                sourceCodes: clientSources,
              })
            : queryClientCallTraceRowsFiltered({
                startDate,
                endDate,
                agingAsOf: agingAsOf || undefined,
                sourceCodes: clientSources,
              })
          : Promise.resolve([]),
      ]);

      traceRows = buildBdMisTraceRows({
        crmRows: crmCallRows.map((row) => ({
          ...row,
          status_bucket: row.status_bucket as import('@/modules/mis/client-import/services/types').StatusBucket,
        })),
        clientRows: clientCallRows,
        sources,
        agingDate,
      });
    }

    return NextResponse.json({
      regionalRows,
      grand,
      crmBranchSummary: crm.branchSummary,
      crmAccountSummary: crm.accountSummary,
      clientAccountSummary,
      sources,
      traceRows,
      syncMeta,
      readSource: 'postgres',
    });
  } catch (err: unknown) {
    console.error('BD MIS Summary Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
