/**
 * Single MIS performance formula: Summary Dashboard account-aligned merge
 * with CRM + Mondelez (Cadbury import) + Coke import all enabled.
 * Client-safe — no Postgres imports (server align lives in .server.ts).
 */

import type { BdMisTraceRow } from '@/modules/mis/services/bd-mis-trace';
import { isPracticeWinmaxOfficeName } from '@/sql/read-model/summary-call-filters';
import {
  buildAccountDisplayRows,
  DEFAULT_CLIENT_MERGE_WITH_CRM,
  isCadburyAccount,
  isCokeAccount,
  sumMergedAccountOpenCalls,
  sumMergedGrandMetric,
  type ClientMergeWithCrmPrefs,
  type MergeSelection,
} from '@/modules/mis/services/account-merge';
import type { AccountSummaryRow, SummaryDashboard } from '@/lib/summary/derive';

export const MIS_UNIFIED_MERGE_FLAGS: MergeSelection = { crm: true, client: true };

export const MIS_UNIFIED_CLIENT_MERGE: ClientMergeWithCrmPrefs = DEFAULT_CLIENT_MERGE_WITH_CRM;

export type MisMetricBundle = {
  total_calls: number;
  solved_calls: number;
  open_calls: number;
  cancelled_calls: number;
};

export type MisSourceBreakdown = {
  crm: MisMetricBundle;
  mondelezImport: MisMetricBundle;
  cokeImport: MisMetricBundle;
  merged: MisMetricBundle;
};

function sumAccountField(rows: AccountSummaryRow[], field: keyof AccountSummaryRow): number {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

function bundleFromAccounts(rows: AccountSummaryRow[]): MisMetricBundle {
  return {
    total_calls: sumAccountField(rows, 'total_calls'),
    solved_calls: sumAccountField(rows, 'total_solved'),
    open_calls: sumAccountField(rows, 'open_calls'),
    cancelled_calls: sumAccountField(rows, 'cancelled_calls'),
  };
}

function isCrmCadburyOrMondelezAccount(account: string): boolean {
  const key = account.trim().toLowerCase();
  return key === 'cadbury' || key === 'mondelez';
}

function isUnifiedExcludedTraceRow(row: BdMisTraceRow): boolean {
  return (
    isPracticeWinmaxOfficeName(row.plant) ||
    isPracticeWinmaxOfficeName(row.office_under_branch)
  );
}

/** Open / cancelled rows that match unified account merge (import-only Cadbury/Coke). */
export function filterTraceRowsForUnifiedOpenExport(traceRows: BdMisTraceRow[]): BdMisTraceRow[] {
  return traceRows.filter((row) => {
    if (isUnifiedExcludedTraceRow(row)) return false;
    if (row.counts_toward === 'cancelled') return true;
    if (row.counts_toward !== 'open') return false;
    if (row.source === 'CRM') {
      const account = String(row.client ?? '');
      if (isCrmCadburyOrMondelezAccount(account) || isCokeAccount(account)) return false;
    }
    return true;
  });
}

export function countUnifiedTraceOpenCalls(traceRows: BdMisTraceRow[]): number {
  return filterTraceRowsForUnifiedOpenExport(traceRows).filter(
    (row) => row.counts_toward === 'open'
  ).length;
}

export function computeMisSourceBreakdown(
  summary: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[]
): MisSourceBreakdown {
  const mondelezRows = clientAccountSummary.filter((row) =>
    isCadburyAccount(String(row.account ?? ''))
  );
  const cokeRows = clientAccountSummary.filter((row) =>
    isCokeAccount(String(row.account ?? ''))
  );

  const mergedRows = buildAccountDisplayRows(
    summary.accountSummary as Array<Record<string, unknown>>,
    clientAccountSummary as Array<Record<string, unknown>>,
    MIS_UNIFIED_MERGE_FLAGS
  );

  const merged: MisMetricBundle = {
    total_calls: sumMergedGrandMetric(
      summary.accountSummary as Array<Record<string, unknown>>,
      clientAccountSummary as Array<Record<string, unknown>>,
      'total_calls',
      MIS_UNIFIED_MERGE_FLAGS,
      MIS_UNIFIED_CLIENT_MERGE,
      mergedRows
    ),
    solved_calls: sumMergedGrandMetric(
      summary.accountSummary as Array<Record<string, unknown>>,
      clientAccountSummary as Array<Record<string, unknown>>,
      'total_solved',
      MIS_UNIFIED_MERGE_FLAGS,
      MIS_UNIFIED_CLIENT_MERGE,
      mergedRows
    ),
    open_calls: sumMergedAccountOpenCalls(
      mergedRows,
      clientAccountSummary as Array<Record<string, unknown>>,
      MIS_UNIFIED_MERGE_FLAGS,
      MIS_UNIFIED_CLIENT_MERGE
    ),
    cancelled_calls: sumMergedGrandMetric(
      summary.accountSummary as Array<Record<string, unknown>>,
      clientAccountSummary as Array<Record<string, unknown>>,
      'cancelled_calls',
      MIS_UNIFIED_MERGE_FLAGS,
      MIS_UNIFIED_CLIENT_MERGE,
      mergedRows
    ),
  };

  return {
    crm: bundleFromAccounts(summary.accountSummary),
    mondelezImport: bundleFromAccounts(mondelezRows),
    cokeImport: bundleFromAccounts(cokeRows),
    merged,
  };
}
