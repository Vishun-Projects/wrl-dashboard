import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/lib/mis-email/source-codes';
import type { RegionalPerformanceRow } from '@/lib/mis-email/mail-types';
import {
  bdMisSourcesFromSelection,
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
  type BdMisGrandRow,
  type BdMisRegionalRow,
  type BdMisSourceFlags,
} from '@/lib/report/bd-mis-summary';
import {
  countTraceOpenCalls,
  filterTraceRowsForSummaryExport,
  type BdMisTraceRow,
} from '@/lib/report/bd-mis-trace';
import type { AccountSummaryRow, SummaryDashboard } from '@/lib/report/summary-derive';

export type { RegionalPerformanceRow } from '@/lib/mis-email/mail-types';

/** CRM − CRM Cadbury (all zones) + Mondelez import (N/E/S) + Coke import. */
export function misEmailBdMisSources(): BdMisSourceFlags {
  return {
    ...bdMisSourcesFromSelection(true, [...MIS_EMAIL_CLIENT_SOURCE_CODES]),
    excludeCrmCadbury: true,
  };
}

export function bdMisRegionalToPerformanceRow(row: BdMisRegionalRow): RegionalPerformanceRow {
  return {
    region: row.region,
    total_calls: row.total_calls,
    solved_calls: row.total_solved,
    cancelled_calls: row.cancelled_calls,
    open_calls: row.open_calls,
    age_2: row.age_2,
    age_3: row.age_3,
    age_7: row.age_7,
    age_15: row.age_15,
    part_pending: row.part_pending,
    active_eng: row.active_eng,
  };
}

export function buildMisEmailRegionalPerformanceRows(
  summary: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[] = []
): RegionalPerformanceRow[] {
  return buildMisEmailBdMisRegionalPayload(summary, clientAccountSummary).performanceRows;
}

export function buildMisEmailBdMisRegionalPayload(
  summary: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[] = []
): {
  regionalRows: BdMisRegionalRow[];
  grand: BdMisGrandRow;
  performanceRows: RegionalPerformanceRow[];
} {
  const sources = misEmailBdMisSources();
  const regionalRows = buildBdMisRegionalRows({
    crmBranchSummary: summary.branchSummary,
    crmAccountSummary: summary.accountSummary,
    clientAccountSummary,
    sources,
  });
  const grand = sumBdMisRegionalGrand(regionalRows);
  return {
    regionalRows,
    grand,
    performanceRows: regionalRows.map(bdMisRegionalToPerformanceRow),
  };
}

export type MisEmailOpenReconciliation = {
  summaryOpen: number;
  traceOpenIncluded: number;
  delta: number;
  matches: boolean;
};

export function reconcileMisEmailOpenCounts(
  grand: BdMisGrandRow,
  traceRows: BdMisTraceRow[]
): MisEmailOpenReconciliation {
  const detailRows = filterTraceRowsForSummaryExport(traceRows);
  const traceOpenIncluded = countTraceOpenCalls(detailRows);
  const summaryOpen = grand.open_calls;
  const delta = traceOpenIncluded - summaryOpen;
  return {
    summaryOpen,
    traceOpenIncluded,
    delta,
    matches: delta === 0,
  };
}
