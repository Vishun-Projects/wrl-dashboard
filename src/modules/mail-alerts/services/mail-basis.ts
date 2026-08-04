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
  filterTraceRowsForOpenExport,
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

/**
 * Contract: regional/branch email body and open-calls Excel share one call-level basis.
 * Also locks body Total (solved+open) to summary-aligned trace detail row count.
 */
export function countMisEmailOpenParity(traceRows: BdMisTraceRow[]): {
  regionalBodyOpen: number;
  branchBodyOpen: number;
  excelOpenRows: number;
  regionalBodyCalls: number;
  branchBodyCalls: number;
  detailRowCount: number;
  detailOpenCount: number;
  detailSolvedCount: number;
} {
  const regional = buildMisEmailRegionalPerformanceRowsFromTrace(traceRows);
  const branch = buildMisEmailBranchPerformanceRowsFromTrace(traceRows);
  const detail = filterTraceRowsForSummaryExport(traceRows);
  const excelOpenRows = filterTraceRowsForOpenExport(traceRows).length;
  const regionalBodyOpen = regional.reduce((sum, row) => sum + row.open_calls, 0);
  const branchBodyOpen = branch.reduce((sum, row) => sum + row.open_calls, 0);
  return {
    regionalBodyOpen,
    branchBodyOpen,
    excelOpenRows,
    regionalBodyCalls: regional.reduce((sum, row) => sum + row.solved_calls + row.open_calls, 0),
    branchBodyCalls: branch.reduce((sum, row) => sum + row.solved_calls + row.open_calls, 0),
    detailRowCount: detail.length,
    detailOpenCount: countTraceOpenCalls(detail),
    detailSolvedCount: detail.filter((row) => row.counts_toward === 'solved').length,
  };
}

function isRealTechnicianName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return v !== '—' && v !== '-' && v.toLowerCase() !== 'unassigned';
}

function accumulateTracePerformanceMetrics<
  T extends {
    total_calls: number;
    solved_calls: number;
    cancelled_calls: number;
    open_calls: number;
    age_2: number;
    age_3: number;
    age_7: number;
    age_15: number;
    engineers: Set<string>;
  },
>(agg: T, row: BdMisTraceRow): void {
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

/**
 * Regional body metrics from the same filtered trace rows as open-calls Excel.
 * Prefer this over summary aggregates whenever digests build a trace payload.
 */
export function buildMisEmailRegionalPerformanceRowsFromTrace(
  traceRows: BdMisTraceRow[]
): RegionalPerformanceRow[] {
  const includedRows = filterTraceRowsForSummaryExport(traceRows);
  const regionMap = new Map<string, RegionalPerformanceRow & { engineers: Set<string> }>();

  for (const row of includedRows) {
    const region = String(row.region ?? 'OTHER').toUpperCase();
    if (!regionMap.has(region)) {
      regionMap.set(region, {
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
    accumulateTracePerformanceMetrics(regionMap.get(region)!, row);
  }

  return [...regionMap.values()]
    .map(({ engineers, ...row }) => ({ ...row, active_eng: engineers.size }))
    .sort((a, b) => a.region.localeCompare(b.region));
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

    accumulateTracePerformanceMetrics(branchMap.get(key)!, row);
  }

  return [...branchMap.values()]
    .map(({ engineers, ...row }) => ({ ...row, active_eng: engineers.size }))
    .sort((a, b) => {
      const age15Diff = b.age_15 - a.age_15;
      if (age15Diff !== 0) return age15Diff;
      return a.branch.localeCompare(b.branch);
    });
}
