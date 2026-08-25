import {
  queryClientCallTraceRowsFiltered,
} from '@/modules/mis/client-import/server';
import type { StatusBucket } from '@/modules/mis/client-import';
import { queryBdMisCrmCallTraceRows, type BdMisCrmCallTraceDbRow } from '@/sql/read-model/bd-mis-summary';
import type { DigestDateRange } from '@/modules/mis-email/services/fetch-digest-data';
import type { UserDigestScope } from '@/modules/mis-email/services/user-scope';
import type { BdMisTraceableExportPayload } from '@/modules/mis';
import { buildBdMisTraceRows } from '@/modules/mis';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/modules/mis';
import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/modules/mis-email/services/source-codes';
import { buildMisEmailBdMisRegionalPayload, misEmailBdMisSources, reconcileMisEmailOpenCounts } from '@/modules/mis-email/services/mail-basis';
import type { AccountSummaryRow, SummaryDashboard } from '@/modules/mis';
import { enrichRegisterRowsRepairDone } from '@/sql/register/repair-done-enrich';

const OPEN_STATUS_BUCKETS = ['open_unallocated', 'assigned'] as const;

export async function buildDigestTraceableExportPayload(
  scope: UserDigestScope,
  dateRange: DigestDateRange,
  summaryData: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[],
  options?: {
    skipRepairDone?: boolean;
    includeTraceableExport?: boolean;
    includeOpenCallsExport?: boolean;
  }
): Promise<BdMisTraceableExportPayload> {
  const sourceCodes = [...MIS_EMAIL_CLIENT_SOURCE_CODES];
  const sources = misEmailBdMisSources();
  // Open-calls-only mail: pull open/assigned rows only — never the full YTD corpus.
  const openOnly =
    !!options?.includeOpenCallsExport && options?.includeTraceableExport !== true;

  const started = Date.now();
  const [crmCallRowsRaw, clientCallRows] = await Promise.all([
    queryBdMisCrmCallTraceRows({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      officeIds: [],
      callTypes: [SUMMARY_DEFAULT_CALL_TYPE],
      assignedOffices: scope.assignedOffices,
      isHod: scope.isHod,
      ...(openOnly ? { statusBuckets: [...OPEN_STATUS_BUCKETS] } : {}),
    }),
    queryClientCallTraceRowsFiltered({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      sourceCodes,
      ...(openOnly ? { statusBuckets: [...OPEN_STATUS_BUCKETS] } : {}),
    }),
  ]);

  console.log(
    `[mis-email/timing] trace export data ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms · crmCalls=${crmCallRowsRaw.length} clientCalls=${clientCallRows.length}${openOnly ? ' · openOnly' : ''}`
  );

  let crmCallRows: Array<BdMisCrmCallTraceDbRow & { repair_done?: string }> = crmCallRowsRaw;
  if (!options?.skipRepairDone) {
    const includeTrace = options?.includeTraceableExport === true;
    const includeOpen = !!options?.includeOpenCallsExport;

    if (includeTrace) {
      crmCallRows = await enrichRegisterRowsRepairDone(crmCallRowsRaw as any[]);
    } else if (includeOpen) {
      const enrichedOpen = (await enrichRegisterRowsRepairDone(crmCallRowsRaw as any[])) as Array<
        BdMisCrmCallTraceDbRow & { repair_done?: string }
      >;
      crmCallRows = enrichedOpen;
    }
  }

  const traceRows = buildBdMisTraceRows({
    crmRows: crmCallRows.map((row) => ({
      ...row,
      status_bucket: row.status_bucket as StatusBucket,
    })),
    clientRows: clientCallRows,
    sources,
    agingDate: dateRange.endDate,
  });

  const { regionalRows, grand } = buildMisEmailBdMisRegionalPayload(
    summaryData,
    clientAccountSummary
  );
  if (!regionalRows.length) {
    throw new Error('No summary data available for traceable export');
  }

  const reconciliation = reconcileMisEmailOpenCounts(grand, traceRows);
  console.log(
    `[mis-email/trace] open reconcile summary=${reconciliation.summaryOpen} trace=${reconciliation.traceOpenIncluded} delta=${reconciliation.delta} match=${reconciliation.matches}${openOnly ? ' · openOnly' : ''}`
  );
  if (!reconciliation.matches) {
    console.warn(
      `[mis-email/trace] open call mismatch — summary ${reconciliation.summaryOpen} vs trace ${reconciliation.traceOpenIncluded} (delta ${reconciliation.delta})`
    );
  }

  return {
    regionalRows,
    grand,
    crmBranchSummary: summaryData.branchSummary,
    crmAccountSummary: summaryData.accountSummary,
    clientAccountSummary,
    sources,
    traceRows,
    traceAlign: 'summary',
    filterMeta: {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      callTypes: SUMMARY_DEFAULT_CALL_TYPE,
      branches: scope.scopeLabel,
      franchisees: 'All Franchisees',
      sources,
    },
  };
}
