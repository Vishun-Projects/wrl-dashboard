import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/modules/mis-email/services/source-codes';
import type { BranchPerformanceRow, RegionalPerformanceRow } from '@/modules/mis-email/services/mail-types';
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
import type { AccountSummaryRow, SummaryDashboard } from '@/lib/summary/derive';

export type { BranchPerformanceRow, RegionalPerformanceRow } from '@/modules/mis-email/services/mail-types';

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

type OpenAgingAgg = {
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  engineers: Set<string>;
};

function emptyOpenAging(): OpenAgingAgg {
  return { open_calls: 0, age_2: 0, age_3: 0, age_7: 0, age_15: 0, engineers: new Set() };
}

function accumulateOpenAging(agg: OpenAgingAgg, row: BdMisTraceRow): void {
  if (row.counts_toward !== 'open') return;
  agg.open_calls += 1;
  const aging = row.aging;
  if (aging === '<2 days') agg.age_2 += 1;
  else if (aging === '>3 days' || aging === '3-7 days') agg.age_3 += 1;
  else if (aging === '>7 days' || aging === '8-15 days') agg.age_7 += 1;
  else if (aging === '>15 days') agg.age_15 += 1;
  const technician = row.technician_name;
  if (technician && technician !== '—' && technician !== '-') {
    const techLower = technician.toLowerCase();
    if (techLower !== 'unassigned') agg.engineers.add(techLower);
  }
}

/**
 * Body open/aging must match the open-calls Excel for the same as-on window.
 * Keep solved/cancelled from summary; replace open columns from Excel row set;
 * rebalance total_calls = solved + cancelled + open.
 */
export function overlayRegionalOpenFromExcelRows(
  summaryRegional: RegionalPerformanceRow[],
  traceRows: BdMisTraceRow[]
): RegionalPerformanceRow[] {
  const byRegion = new Map<string, OpenAgingAgg>();
  for (const row of filterTraceRowsForOpenExport(traceRows)) {
    if (row.counts_toward !== 'open') continue;
    const region = String(row.region ?? 'OTHER').toUpperCase();
    let agg = byRegion.get(region);
    if (!agg) {
      agg = emptyOpenAging();
      byRegion.set(region, agg);
    }
    accumulateOpenAging(agg, row);
  }

  return summaryRegional.map((row) => {
    const open = byRegion.get(String(row.region ?? '').toUpperCase()) ?? emptyOpenAging();
    return {
      ...row,
      open_calls: open.open_calls,
      age_2: open.age_2,
      age_3: open.age_3,
      age_7: open.age_7,
      age_15: open.age_15,
      active_eng: open.engineers.size,
      total_calls: row.solved_calls + row.cancelled_calls + open.open_calls,
    };
  });
}

export function overlayBranchOpenFromExcelRows(
  summaryBranch: BranchPerformanceRow[],
  traceRows: BdMisTraceRow[]
): BranchPerformanceRow[] {
  const byKey = new Map<string, OpenAgingAgg>();
  for (const row of filterTraceRowsForOpenExport(traceRows)) {
    if (row.counts_toward !== 'open') continue;
    const region = String(row.region ?? 'OTHER').toUpperCase();
    const branch = row.plant?.trim() || '—';
    const key = `${region}::${branch}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = emptyOpenAging();
      byKey.set(key, agg);
    }
    accumulateOpenAging(agg, row);
  }

  return summaryBranch.map((row) => {
    const key = `${String(row.region ?? '').toUpperCase()}::${row.branch}`;
    const open = byKey.get(key) ?? emptyOpenAging();
    return {
      ...row,
      open_calls: open.open_calls,
      age_2: open.age_2,
      age_3: open.age_3,
      age_7: open.age_7,
      age_15: open.age_15,
      active_eng: open.engineers.size,
      total_calls: row.solved_calls + row.cancelled_calls + open.open_calls,
    };
  });
}

function branchPerformanceKey(region: unknown, branch: unknown): string {
  return `${String(region ?? '').trim().toUpperCase()}::${String(branch ?? '').trim().toLowerCase()}`;
}

/** Collapse duplicate branch labels (franchisee offices → one row). */
export function mergeBranchPerformanceRowsByName(rows: BranchPerformanceRow[]): BranchPerformanceRow[] {
  const map = new Map<string, BranchPerformanceRow>();
  for (const row of rows) {
    const key = branchPerformanceKey(row.region, row.branch);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    map.set(key, {
      branch: prev.branch || row.branch,
      region: prev.region || row.region,
      total_calls: prev.total_calls + row.total_calls,
      solved_calls: prev.solved_calls + row.solved_calls,
      cancelled_calls: prev.cancelled_calls + row.cancelled_calls,
      open_calls: prev.open_calls + row.open_calls,
      age_2: prev.age_2 + row.age_2,
      age_3: prev.age_3 + row.age_3,
      age_7: prev.age_7 + row.age_7,
      age_15: prev.age_15 + row.age_15,
      part_pending: prev.part_pending + row.part_pending,
      active_eng: Math.max(prev.active_eng, row.active_eng),
    });
  }
  return [...map.values()].sort((a, b) => {
    const age15Diff = b.age_15 - a.age_15;
    if (age15Diff !== 0) return age15Diff;
    return String(a.branch).localeCompare(String(b.branch));
  });
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
 * Internal summary↔trace open must match exactly after hot is repaired.
 * Day-over-day report drift is separate; this gate only catches same-mail inconsistency.
 */
export function assertMisEmailOpenParity(
  reconciliation: MisEmailOpenReconciliation,
  opts?: { maxAbsDelta?: number; context?: string }
): void {
  const maxAbsDelta = Math.max(0, opts?.maxAbsDelta ?? 0);
  if (Math.abs(reconciliation.delta) <= maxAbsDelta) return;
  const where = opts?.context ? ` (${opts.context})` : '';
  throw new Error(
    `MIS open-count mismatch${where}: summary open=${reconciliation.summaryOpen} ` +
      `trace open=${reconciliation.traceOpenIncluded} delta=${reconciliation.delta}. ` +
      `Refuse send until calls_latest_hot open/cancel drift is repaired and both bases use the same snapshot.`
  );
}

/**
 * Contract: regional/branch email body and open-calls Excel share one call-level basis.
 * Body Total = solved + open + cancelled; detail row count matches that total.
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
  const bodyCalls = (row: { solved_calls: number; open_calls: number; cancelled_calls: number }) =>
    row.solved_calls + row.open_calls + row.cancelled_calls;
  return {
    regionalBodyOpen,
    branchBodyOpen,
    excelOpenRows,
    regionalBodyCalls: regional.reduce((sum, row) => sum + bodyCalls(row), 0),
    branchBodyCalls: branch.reduce((sum, row) => sum + bodyCalls(row), 0),
    detailRowCount: detail.length,
    detailOpenCount: countTraceOpenCalls(detail),
    detailSolvedCount: detail.filter((row) => row.counts_toward === 'solved').length,
  };
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
    const aging = row.aging;
    if (aging === '<2 days') agg.age_2 += 1;
    else if (aging === '>3 days' || aging === '3-7 days') agg.age_3 += 1;
    else if (aging === '>7 days' || aging === '8-15 days') agg.age_7 += 1;
    else if (aging === '>15 days') agg.age_15 += 1;
  } else if (row.counts_toward === 'cancelled') {
    agg.cancelled_calls += 1;
  }

  const technician = row.technician_name;
  if (technician && technician !== '—' && technician !== '-') {
    const techLower = technician.toLowerCase();
    if (techLower !== 'unassigned') {
      agg.engineers.add(techLower);
    }
  }
}

export function buildMisEmailRegionalAndBranchRowsFromTrace(
  traceRows: BdMisTraceRow[]
): {
  regional: RegionalPerformanceRow[];
  branch: BranchPerformanceRow[];
} {
  const regionMap = new Map<string, RegionalPerformanceRow & { engineers: Set<string> }>();
  const branchMap = new Map<string, BranchPerformanceRow & { engineers: Set<string> }>();
  const includedRows = filterTraceRowsForSummaryExport(traceRows);

  for (const row of includedRows) {
    const region = String(row.region ?? 'OTHER').toUpperCase();
    let regAgg = regionMap.get(region);
    if (!regAgg) {
      regAgg = {
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
      };
      regionMap.set(region, regAgg);
    }
    accumulateTracePerformanceMetrics(regAgg, row);

    const branch = row.plant?.trim() || '—';
    const key = `${region}::${branch}`;
    let brAgg = branchMap.get(key);
    if (!brAgg) {
      brAgg = {
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
      };
      branchMap.set(key, brAgg);
    }
    accumulateTracePerformanceMetrics(brAgg, row);
  }

  const regional = [...regionMap.values()]
    .map(({ engineers, ...row }) => ({ ...row, active_eng: engineers.size }))
    .sort((a, b) => a.region.localeCompare(b.region));

  const branch = [...branchMap.values()]
    .map(({ engineers, ...row }) => ({ ...row, active_eng: engineers.size }))
    .sort((a, b) => {
      const age15Diff = b.age_15 - a.age_15;
      if (age15Diff !== 0) return age15Diff;
      return a.branch.localeCompare(b.branch);
    });

  return { regional, branch };
}

export function buildMisEmailRegionalPerformanceRowsFromTrace(
  traceRows: BdMisTraceRow[]
): RegionalPerformanceRow[] {
  return buildMisEmailRegionalAndBranchRowsFromTrace(traceRows).regional;
}

export function buildMisEmailBranchPerformanceRowsFromTrace(
  traceRows: BdMisTraceRow[]
): BranchPerformanceRow[] {
  return buildMisEmailRegionalAndBranchRowsFromTrace(traceRows).branch;
}
