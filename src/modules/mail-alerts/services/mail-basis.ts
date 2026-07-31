import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/modules/mail-alerts/services/source-codes';
import type { BranchPerformanceRow, RegionalPerformanceRow } from '@/modules/mail-alerts/services/mail-types';
import {
  bdMisSourcesFromSelection,
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
  type BdMisGrandRow,
  type BdMisRegionalRow,
  type BdMisSourceFlags,
} from '@/modules/mis';
import {
  countTraceOpenCalls,
  filterTraceRowsForSummaryExport,
  type BdMisTraceRow,
} from '@/modules/mis';
import type { AccountSummaryRow, SummaryDashboard } from '@/modules/mis';

export type { BranchPerformanceRow, RegionalPerformanceRow } from '@/modules/mail-alerts/services/mail-types';

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

function isRealTechnicianName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return v !== '—' && v !== '-' && v.toLowerCase() !== 'unassigned';
}

export function buildMisEmailBranchPerformanceRowsFromTrace(
  traceRows: BdMisTraceRow[]
): BranchPerformanceRow[] {
  const includedRows = filterTraceRowsForSummaryExport(traceRows);
  const branchMap = new Map<string, BranchPerformanceRow & { engineers: Set<string> }>();

  for (const row of includedRows) {
    const branch = row.plant?.trim() || '—';
    const region = String(row.region ?? 'OTHER').toUpperCase();
    const key = `${region}::${branch}`;
    if (!branchMap.has(key)) {
      branchMap.set(key, {
        branch,
        region,
        total_calls: 0,
        solved_calls: 0,
        cancelled_calls: 0,
        open_calls: 0,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        active_eng: 0,
        engineers: new Set<string>(),
      });
    }

    const agg = branchMap.get(key)!;
    agg.total_calls += 1;
    if (row.counts_toward === 'solved') {
      agg.solved_calls += 1;
    } else if (row.counts_toward === 'open') {
      agg.open_calls += 1;
      const aging = String(row.aging ?? '').trim().toLowerCase();
      if (aging === '<2 days') agg.age_2 += 1;
      else if (aging === '>3 days' || aging === '3-7 days') agg.age_3 += 1;
      else if (aging === '>7 days' || aging === '8-15 days') agg.age_7 += 1;
      else if (aging === '>15 days') agg.age_15 += 1;
    }

    const technician = row.technician_name?.trim() ?? '';
    if (isRealTechnicianName(technician)) {
      agg.engineers.add(technician.toLowerCase());
    }
  }

  return [...branchMap.values()]
    .map(({ engineers, ...row }) => ({ ...row, active_eng: engineers.size }))
    .sort((a, b) => {
      const age15Diff = b.age_15 - a.age_15;
      if (age15Diff !== 0) return age15Diff;
      return a.branch.localeCompare(b.branch);
    });
}
