import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/modules/mis-email/services/source-codes';
import type { BranchPerformanceRow, RegionalPerformanceRow } from '@/modules/mis-email/services/mail-types';
import {
  bdMisSourcesFromSelection,
  buildBdMisRegionalRows,
  countTraceOpenCalls,
  filterTraceRowsForOpenExport,
  filterTraceRowsForSummaryExport,
  filterTraceRowsForUnifiedOpenExport,
  sumBdMisRegionalGrand,
  type BdMisGrandRow,
  type BdMisRegionalRow,
  type BdMisSourceFlags,
  type BdMisTraceRow,
  type SummaryDashboardExportAlign,
  type UiBranchPerformanceRow,
  type UiRegionalPerformanceRow,
} from '@/modules/mis';
import { buildMisUnifiedReportAlign } from '@/modules/mis/server';
import type { AccountSummaryRow, BranchSummaryRow, SummaryDashboard } from '@/lib/summary/derive';

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
  for (const row of filterTraceRowsForUnifiedOpenExport(traceRows)) {
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
  traceRows: BdMisTraceRow[],
  branchSummary?: BranchSummaryRow[]
): BranchPerformanceRow[] {
  const byKey = new Map<string, OpenAgingAgg>();
  for (const row of filterTraceRowsForUnifiedOpenExport(traceRows)) {
    if (row.counts_toward !== 'open') continue;
    const region = String(row.region ?? 'OTHER').toUpperCase();
    const resolved = resolveTracePlantToWrlBranch(row.plant ?? '', region, branchSummary);
    if (!resolved) continue;
    const key = `${String(resolved.region).toUpperCase()}::${resolved.branch}`;
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
  // Same open basis as WRL_BD_MIS_Open_Calls attachment (unified filter, open rows only).
  const excelOpenRows = filterTraceRowsForUnifiedOpenExport(traceRows).filter(
    (row) => row.counts_toward === 'open'
  ).length;
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
  // Count every included row into exactly one status bucket (solved / open / cancelled).
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
  } else {
    return;
  }
  agg.total_calls = agg.solved_calls + agg.open_calls + agg.cancelled_calls;

  const technician = row.technician_name;
  if (technician && technician !== '—' && technician !== '-') {
    const techLower = technician.toLowerCase();
    if (techLower !== 'unassigned') {
      agg.engineers.add(techLower);
    }
  }
}

function isCrmTopLevelBranch(
  row: BranchSummaryRow,
  byId: Map<number, BranchSummaryRow>
): boolean {
  return row.parentId === 0 || !byId.has(row.parentId);
}

function crmTopLevelBranch(
  row: BranchSummaryRow,
  byId: Map<number, BranchSummaryRow>
): BranchSummaryRow {
  let cur = row;
  const seen = new Set<number>();
  while (!isCrmTopLevelBranch(cur, byId) && !seen.has(cur.officeId)) {
    seen.add(cur.officeId);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/**
 * Map trace plant labels onto CRM top-level WRL branches (same shape as yesterday's mail).
 * Franchisee offices like ncode 1127 "POWER REFRIGERATION" roll into their parent (Patna),
 * not a fake "1127 - POWER REFRIGERATION" branch row.
 */
export function resolveTracePlantToWrlBranch(
  plant: string,
  region: string,
  branchSummary: BranchSummaryRow[] | undefined
): { branch: string; region: string } | null {
  const label = plant.trim();
  // Without CRM office tree, keep prior plant/— behavior for fixtures.
  if (!branchSummary?.length) {
    return { branch: label || '—', region };
  }
  if (!label || label === '—') return null;

  const byId = new Map(branchSummary.map((b) => [b.officeId, b]));
  const byName = new Map(branchSummary.map((b) => [b.branch.trim().toLowerCase(), b]));

  const named = byName.get(label.toLowerCase());
  if (named) {
    const top = crmTopLevelBranch(named, byId);
    return { branch: top.branch, region: top.region || region };
  }

  const codeMatch = label.match(/^(\d+)\s*-/);
  if (codeMatch) {
    const officeId = Number(codeMatch[1]);
    const office = byId.get(officeId);
    if (office) {
      const top = crmTopLevelBranch(office, byId);
      return { branch: top.branch, region: top.region || region };
    }
    // Only treat "NNNN - … BRANCH" as SAP-style top-level label (Guwahati ncode≠1127).
    // Do not map "1127 - POWER REFRIGERATION" → Guwahati via the numeric prefix.
    if (/branch$/i.test(label)) {
      const prefix = `${codeMatch[1]} -`.toLowerCase();
      for (const b of branchSummary) {
        if (!isCrmTopLevelBranch(b, byId)) continue;
        if (b.branch.trim().toLowerCase().startsWith(prefix) && /branch$/i.test(b.branch)) {
          return { branch: b.branch, region: b.region || region };
        }
      }
    }
  }

  if (/^\d+\s*-\s*.+\s+BRANCH$/i.test(label)) {
    return { branch: label, region };
  }
  return null;
}

export function buildMisEmailRegionalAndBranchRowsFromTrace(
  traceRows: BdMisTraceRow[],
  branchSummary?: BranchSummaryRow[]
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

    const resolved = resolveTracePlantToWrlBranch(row.plant ?? '', region, branchSummary);
    if (!resolved) continue;
    const branch = resolved.branch;
    const branchRegion = String(resolved.region ?? region).toUpperCase();
    const key = `${branchRegion}::${branch}`;
    let brAgg = branchMap.get(key);
    if (!brAgg) {
      brAgg = {
        branch,
        region: branchRegion,
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
  traceRows: BdMisTraceRow[],
  branchSummary?: BranchSummaryRow[]
): RegionalPerformanceRow[] {
  return buildMisEmailRegionalAndBranchRowsFromTrace(traceRows, branchSummary).regional;
}

/** Key Account body rows — same included call-level basis as open-calls Excel. */
export function buildMisEmailKeyAccountRowsFromTrace(
  traceRows: BdMisTraceRow[]
): Array<Record<string, unknown>> {
  type Agg = {
    region: string;
    account: string;
    total_calls: number;
    solved_calls: number;
    cancelled_calls: number;
    open_calls: number;
    age_2: number;
    age_3: number;
    age_7: number;
    age_15: number;
    part_pending: number;
    active_eng: number;
    population: number;
    headcount: number;
    deployment_total: number;
    deployment_done: number;
    installation_total: number;
    installation_done: number;
    total_tech_solved: number;
    engineers: Set<string>;
  };
  const map = new Map<string, Agg>();
  for (const row of filterTraceRowsForSummaryExport(traceRows)) {
    const region = String(row.region ?? 'OTHER').toUpperCase();
    const account = String(row.client ?? '').trim() || '—';
    const key = `${region}::${account.toLowerCase()}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        region,
        account,
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
        population: 0,
        headcount: 0,
        deployment_total: 0,
        deployment_done: 0,
        installation_total: 0,
        installation_done: 0,
        total_tech_solved: 0,
        engineers: new Set<string>(),
      };
      map.set(key, agg);
    }
    accumulateTracePerformanceMetrics(agg, row);
  }
  return [...map.values()]
    .map(({ engineers, solved_calls, ...row }) => ({
      ...row,
      // AccountSummaryRow / Key Account merge read total_solved.
      total_solved: solved_calls,
      active_eng: engineers.size,
    }))
    .sort((a, b) => {
      const zoneCmp = a.region.localeCompare(b.region);
      if (zoneCmp !== 0) return zoneCmp;
      return a.account.localeCompare(b.account);
    });
}

function uiRegionalToPerformanceRow(row: UiRegionalPerformanceRow): RegionalPerformanceRow {
  return {
    region: row.region,
    total_calls: row.total_calls,
    solved_calls: row.solved_calls,
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

function uiBranchToPerformanceRow(row: UiBranchPerformanceRow): BranchPerformanceRow {
  return {
    branch: row.branch,
    region: row.region,
    total_calls: row.total_calls,
    solved_calls: row.solved_calls,
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

/** Email body regional/branch rows — unified formula (same as Summary Dashboard AI row). */
export async function buildMisEmailSummaryDashboardBodyRows(
  summary: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[],
  dateRange: { startDate: string; endDate: string }
): Promise<{ regional: RegionalPerformanceRow[]; branch: BranchPerformanceRow[] }> {
  const align = await buildMisUnifiedReportAlign(summary, clientAccountSummary, dateRange);
  return {
    regional: align.regionalRows.map(uiRegionalToPerformanceRow),
    branch: align.branchRows.map(uiBranchToPerformanceRow),
  };
}

export async function buildMisEmailUnifiedReportAlign(
  summary: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[],
  dateRange: { startDate: string; endDate: string }
): Promise<SummaryDashboardExportAlign> {
  return buildMisUnifiedReportAlign(summary, clientAccountSummary, dateRange);
}

export function buildMisEmailBranchPerformanceRowsFromTrace(
  traceRows: BdMisTraceRow[],
  branchSummary?: BranchSummaryRow[]
): BranchPerformanceRow[] {
  return buildMisEmailRegionalAndBranchRowsFromTrace(traceRows, branchSummary).branch;
}
