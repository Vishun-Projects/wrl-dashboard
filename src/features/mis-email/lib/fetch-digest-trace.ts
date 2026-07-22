import {
  queryClientCallTraceRowsFiltered,
} from '@/features/mis-import/server';
import type { StatusBucket } from '@/features/mis-import';
import { queryBdMisCrmCallTraceRows } from '@/lib/read-model/queries/bd-mis-summary';
import type { DigestDateRange } from '@/features/mis-email/lib/fetch-digest-data';
import type { UserDigestScope } from '@/features/mis-email/lib/user-scope';
import type { BdMisTraceableExportPayload } from '@/features/report';
import { buildBdMisTraceRows } from '@/features/report';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/features/report';
import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/features/mis-email/lib/source-codes';
import { buildMisEmailBdMisRegionalPayload, misEmailBdMisSources, reconcileMisEmailOpenCounts } from '@/features/mis-email/lib/mail-basis';
import type { AccountSummaryRow, SummaryDashboard } from '@/features/report';

export async function buildDigestTraceableExportPayload(
  scope: UserDigestScope,
  dateRange: DigestDateRange,
  summaryData: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[]
): Promise<BdMisTraceableExportPayload> {
  // Mondelez + Coke client imports; CRM Cadbury replaced by Mondelez file in union formula.
  const sourceCodes = [...MIS_EMAIL_CLIENT_SOURCE_CODES];
  const sources = misEmailBdMisSources();

  const started = Date.now();
  const [crmCallRows, clientCallRows] = await Promise.all([
    queryBdMisCrmCallTraceRows({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      officeIds: [],
      callTypes: [SUMMARY_DEFAULT_CALL_TYPE],
      assignedOffices: scope.assignedOffices,
      isHod: scope.isHod,
    }),
    queryClientCallTraceRowsFiltered({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      agingAsOf: dateRange.endDate,
      sourceCodes,
    }),
  ]);

  console.log(
    `[mis-email/timing] trace export data ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms · crmCalls=${crmCallRows.length} clientCalls=${clientCallRows.length}`
  );

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
    `[mis-email/trace] open reconcile summary=${reconciliation.summaryOpen} trace=${reconciliation.traceOpenIncluded} delta=${reconciliation.delta} match=${reconciliation.matches}`
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
