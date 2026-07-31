/**
 * BD MIS regional summary union rules:
 * - Cadbury: import only — subtract CRM Cadbury/Mondelez (N/E/S), add client Cadbury.
 * - Coke: CRM + import — keep CRM Coke in branch base, add client Coke (South); never subtract CRM Coke.
 */

import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/summary/derive';
import { formatDisplayRegion } from '@/features/mis-import';
import { openCallsFromAging as openCallsFromAgingBuckets } from '@/lib/aging/buckets';

export { openCallsFromAgingBuckets as openCallsFromAging };

export const BD_MIS_ZONES = [
  'NORTH ZONE',
  'EAST ZONE',
  'WEST ZONE',
  'SOUTH ZONE',
] as const;

export type BdMisZone = (typeof BD_MIS_ZONES)[number];

export type BdMisSourceFlags = {
  crm: boolean;
  cadbury: boolean;
  coke: boolean;
  /** MIS email: subtract CRM Cadbury/Mondelez without substituting Mondelez import. */
  excludeCrmCadbury?: boolean;
};

export type BdMisMetricBundle = {
  total_calls: number;
  total_solved: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  active_eng: number;
};

export type BdMisRegionalRow = BdMisMetricBundle & {
  region: BdMisZone;
  open_calls: number;
};

export function emptyBdMisMetrics(): BdMisMetricBundle {
  return {
    total_calls: 0,
    total_solved: 0,
    cancelled_calls: 0,
    open_calls: 0,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    active_eng: 0,
  };
}

/** Excel Summary: open = total − solved (cancelled excluded from both). */
export function openCallsFromTotals(
  m: Pick<BdMisMetricBundle, 'total_calls' | 'total_solved'>
): number {
  return Math.max(0, m.total_calls - m.total_solved);
}

function isCadburyAccount(account: string): boolean {
  return account.trim().toLowerCase() === 'cadbury';
}

function isCokeAccount(account: string): boolean {
  return account.trim().toLowerCase() === 'coke';
}

function isCrmCadburyAccount(account: string): boolean {
  const key = account.trim().toLowerCase();
  return key === 'cadbury' || key === 'mondelez';
}

/** CRM Coke/HCCB accounts — kept in branch base when Coke import is merged (both count). */


function regionsMatch(zone: string, rowRegion: string): boolean {
  return formatDisplayRegion(rowRegion) === formatDisplayRegion(zone);
}

function metricsFromBranch(row: BranchSummaryRow): BdMisMetricBundle {
  return {
    total_calls: Number(row.total_calls ?? 0),
    total_solved: Number(row.solved_calls ?? 0),
    cancelled_calls: Number(row.cancelled_calls ?? 0),
    open_calls: Number(row.open_calls ?? 0),
    age_2: Number(row.age_2 ?? 0),
    age_3: Number(row.age_3 ?? 0),
    age_7: Number(row.age_7 ?? 0),
    age_15: Number(row.age_15 ?? 0),
    part_pending: Number(row.part_pending ?? 0),
    active_eng: Number(row.active_eng ?? 0),
  };
}

function metricsFromAccount(row: AccountSummaryRow): BdMisMetricBundle {
  return {
    total_calls: Number(row.total_calls ?? 0),
    total_solved: Number(row.total_solved ?? 0),
    cancelled_calls: Number(row.cancelled_calls ?? 0),
    open_calls: Number(row.open_calls ?? 0),
    age_2: Number(row.age_2 ?? 0),
    age_3: Number(row.age_3 ?? 0),
    age_7: Number(row.age_7 ?? 0),
    age_15: Number(row.age_15 ?? 0),
    part_pending: Number(row.part_pending ?? 0),
    active_eng: Number(row.active_eng ?? 0),
  };
}

export function addBdMisMetrics(a: BdMisMetricBundle, b: BdMisMetricBundle): BdMisMetricBundle {
  return {
    total_calls: a.total_calls + b.total_calls,
    total_solved: a.total_solved + b.total_solved,
    cancelled_calls: a.cancelled_calls + b.cancelled_calls,
    open_calls: a.open_calls + b.open_calls,
    age_2: a.age_2 + b.age_2,
    age_3: a.age_3 + b.age_3,
    age_7: a.age_7 + b.age_7,
    age_15: a.age_15 + b.age_15,
    part_pending: a.part_pending + b.part_pending,
    active_eng: a.active_eng + b.active_eng,
  };
}

export function subtractBdMisMetrics(a: BdMisMetricBundle, b: BdMisMetricBundle): BdMisMetricBundle {
  return {
    total_calls: a.total_calls - b.total_calls,
    total_solved: a.total_solved - b.total_solved,
    cancelled_calls: a.cancelled_calls - b.cancelled_calls,
    open_calls: a.open_calls - b.open_calls,
    age_2: a.age_2 - b.age_2,
    age_3: a.age_3 - b.age_3,
    age_7: a.age_7 - b.age_7,
    age_15: a.age_15 - b.age_15,
    part_pending: a.part_pending - b.part_pending,
    active_eng: a.active_eng - b.active_eng,
  };
}

function sumBranchMetricsInZone(
  branches: BranchSummaryRow[],
  zone: BdMisZone
): BdMisMetricBundle {
  return branches
    .filter((b) => regionsMatch(zone, String(b.region ?? '')))
    .reduce((acc, row) => addBdMisMetrics(acc, metricsFromBranch(row)), emptyBdMisMetrics());
}

function sumAccountMetricsInZone(
  accounts: AccountSummaryRow[],
  zone: BdMisZone,
  predicate: (account: string) => boolean
): BdMisMetricBundle {
  return accounts
    .filter((a) => regionsMatch(zone, String(a.region ?? '')) && predicate(String(a.account ?? '')))
    .reduce((acc, row) => addBdMisMetrics(acc, metricsFromAccount(row)), emptyBdMisMetrics());
}

export type BdMisRegionalBreakdown = {
  region: BdMisZone;
  crmBranchBase: BdMisMetricBundle;
  subtractCrmCadbury: BdMisMetricBundle;
  addClientCadbury: BdMisMetricBundle;
  subtractCrmCoke: BdMisMetricBundle;
  addClientCoke: BdMisMetricBundle;
  result: BdMisRegionalRow;
};

/** Per-zone steps that produce dashboard regional totals (for audit export). */
export function buildBdMisRegionalBreakdown(params: {
  crmBranchSummary: BranchSummaryRow[];
  crmAccountSummary: AccountSummaryRow[];
  clientAccountSummary: AccountSummaryRow[];
  sources: BdMisSourceFlags;
}): BdMisRegionalBreakdown[] {
  const { crmBranchSummary, crmAccountSummary, clientAccountSummary, sources } = params;

  return BD_MIS_ZONES.map((zone) => {
    const steps = applyBdMisZoneUnion(
      zone,
      crmBranchSummary,
      crmAccountSummary,
      clientAccountSummary,
      sources
    );
    return {
      region: zone,
      crmBranchBase: steps.crmBranchBase,
      subtractCrmCadbury: steps.subtractCrmCadbury,
      addClientCadbury: steps.addClientCadbury,
      subtractCrmCoke: steps.subtractCrmCoke,
      addClientCoke: steps.addClientCoke,
      result: toRegionalRow(zone, steps.result),
    };
  });
}

/** All Coke client-import rows roll into South (HCCB Files in BD MIS Excel). */
export function sumClientCokeMetricsSouth(clientAccounts: AccountSummaryRow[]): BdMisMetricBundle {
  return clientAccounts
    .filter((a) => isCokeAccount(String(a.account ?? '')))
    .reduce((acc, row) => addBdMisMetrics(acc, metricsFromAccount(row)), emptyBdMisMetrics());
}

function sumClientCadburyInZone(
  clientAccounts: AccountSummaryRow[],
  zone: BdMisZone
): BdMisMetricBundle {
  if (zone === 'WEST ZONE') return emptyBdMisMetrics();
  return sumAccountMetricsInZone(clientAccounts, zone, isCadburyAccount);
}

type ZoneUnionSteps = {
  crmBranchBase: BdMisMetricBundle;
  subtractCrmCadbury: BdMisMetricBundle;
  addClientCadbury: BdMisMetricBundle;
  subtractCrmCoke: BdMisMetricBundle;
  addClientCoke: BdMisMetricBundle;
  result: BdMisMetricBundle;
};

/** When true, CRM Cadbury is subtracted in every zone (MIS mail — import-only Cadbury). */
function shouldSubtractCrmCadbury(zone: BdMisZone, sources: BdMisSourceFlags): boolean {
  if (!sources.crm) return false;
  if (sources.excludeCrmCadbury === true) return true;
  return sources.cadbury && zone !== 'WEST ZONE';
}

/** Apply per-zone source union (Cadbury import-only, Coke CRM + import). */
function applyBdMisZoneUnion(
  zone: BdMisZone,
  crmBranchSummary: BranchSummaryRow[],
  crmAccountSummary: AccountSummaryRow[],
  clientAccountSummary: AccountSummaryRow[],
  sources: BdMisSourceFlags
): ZoneUnionSteps {
  const crmBranchBase = sources.crm
    ? sumBranchMetricsInZone(crmBranchSummary, zone)
    : emptyBdMisMetrics();

  const subtractCrmCadbury = shouldSubtractCrmCadbury(zone, sources)
    ? sumAccountMetricsInZone(crmAccountSummary, zone, isCrmCadburyAccount)
    : emptyBdMisMetrics();

  const addClientCadbury =
    sources.cadbury && zone !== 'WEST ZONE'
      ? sumClientCadburyInZone(clientAccountSummary, zone)
      : emptyBdMisMetrics();

  // Coke: never subtract CRM — both CRM Coke (in branch base) and import Coke count.
  const subtractCrmCoke = emptyBdMisMetrics();

  const addClientCoke =
    sources.coke && zone === 'SOUTH ZONE'
      ? sumClientCokeMetricsSouth(clientAccountSummary)
      : emptyBdMisMetrics();

  let result = crmBranchBase;

  if (shouldSubtractCrmCadbury(zone, sources)) {
    result = subtractBdMisMetrics(result, subtractCrmCadbury);
  }
  if (sources.cadbury && zone !== 'WEST ZONE') {
    result = addBdMisMetrics(result, addClientCadbury);
  } else if (!sources.crm && sources.cadbury && zone !== 'WEST ZONE') {
    result = addBdMisMetrics(result, addClientCadbury);
  }

  if (sources.coke && zone === 'SOUTH ZONE') {
    result = addBdMisMetrics(result, addClientCoke);
  }

  return {
    crmBranchBase,
    subtractCrmCadbury,
    addClientCadbury,
    subtractCrmCoke,
    addClientCoke,
    result,
  };
}

function toRegionalRow(zone: BdMisZone, metrics: BdMisMetricBundle): BdMisRegionalRow {
  return {
    region: zone,
    ...metrics,
    open_calls: Math.max(0, metrics.open_calls),
  };
}

/**
 * Build regional rows matching New_BD_MIS Excel Summary union.
 */
export function buildBdMisRegionalRows(params: {
  crmBranchSummary: BranchSummaryRow[];
  crmAccountSummary: AccountSummaryRow[];
  clientAccountSummary: AccountSummaryRow[];
  sources: BdMisSourceFlags;
}): BdMisRegionalRow[] {
  const { crmBranchSummary, crmAccountSummary, clientAccountSummary, sources } = params;

  return BD_MIS_ZONES.map((zone) => {
    const steps = applyBdMisZoneUnion(
      zone,
      crmBranchSummary,
      crmAccountSummary,
      clientAccountSummary,
      sources
    );
    return toRegionalRow(zone, steps.result);
  });
}

export type BdMisGrandRow = BdMisMetricBundle & {
  region: 'ALL';
  open_calls: number;
};

export function sumBdMisRegionalGrand(rows: BdMisRegionalRow[]): BdMisGrandRow {
  const grand = rows.reduce((acc, row) => addBdMisMetrics(acc, row), emptyBdMisMetrics());
  return {
    region: 'ALL',
    ...grand,
    open_calls: Math.max(0, grand.open_calls),
  };
}

export function bdMisSourcesFromSelection(
  crm: boolean,
  clientSourceCodes: string[]
): BdMisSourceFlags {
  const codes = new Set(clientSourceCodes.map((c) => c.toLowerCase()));
  return {
    crm,
    cadbury: codes.has('cadbury'),
    coke: codes.has('coke'),
  };
}
