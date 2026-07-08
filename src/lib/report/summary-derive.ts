/**
 * Client-side summary / Key Account MIS from corpus rows.
 * Mirrors aggregation in /api/report/summary (Node rollup section).
 */

import { matchesCallTypeFilter, normalizeCallTypeDisplay, resolveAgingAsOfDate } from '@/lib/report/filters';
import {
  resolveMainBranchDisplayName,
  resolveMainBranchOfficeId,
} from '@/lib/read-model/queries/main-branch-resolve';
import { incrementAgingBucket, openCallsFromAging } from '@/lib/report/aging-buckets';

export type BranchSummaryRow = {
  officeId: number;
  parentId: number;
  branch: string;
  region: string;
  total_calls: number;
  solved_calls: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  all_total: number;
  all_solved: number;
  all_cancelled: number;
  all_open: number;
  all_age_2: number;
  all_age_3: number;
  all_age_7: number;
  all_age_15: number;
  all_part_pending: number;
  all_tech_solved: number;
  tech_solved_calls: number;
  deployment_total: number;
  deployment_done: number;
  installation_total: number;
  installation_done: number;
  active_eng: number;
  population: number;
  headcount: number;
};

export type AccountSummaryRow = {
  region: string;
  account: string;
  population: number;
  total_calls: number;
  total_solved: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  deployment_total: number;
  deployment_done: number;
  installation_total: number;
  installation_done: number;
  active_eng: number;
  headcount: number;
  total_tech_solved: number;
};

export type SummaryDashboard = {
  branchSummary: BranchSummaryRow[];
  accountSummary: AccountSummaryRow[];
  globalHeadcount: number;
};

export type DeriveSummaryOptions = {
  agingAsOf?: string;
  endDate?: string;
  officeIdsParam?: string;
  callTypesParam?: string;
};

const BREAKDOWN = 'BREAKDOWN';
const DEPLOYMENT = 'DEPLOYMENT';
const INSTALLATION = 'INSTALLATION CALL';

function truthyOne(value: unknown): boolean {
  return value === 1 || value === true || value === '1' || value === 'True';
}

export function isSummaryEligibleCall(row: Record<string, unknown>): boolean {
  const transfer = String(row.vtransfercallno ?? '').trim();
  if (transfer !== '') return false;
  const cancel = Number(row.ncancelreason ?? 0);
  if (cancel === 2) return false;
  const trn = String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
  return trn !== '';
}

function matchesOfficeFilter(row: Record<string, unknown>, officeIdsParam?: string): boolean {
  if (!officeIdsParam || officeIdsParam === 'All' || officeIdsParam === 'undefined' || officeIdsParam === 'null') {
    return true;
  }
  const officeId = String(row.officeId ?? row.nofficeid ?? '');
  return officeIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(officeId);
}

function resolveAgingDate(opts: DeriveSummaryOptions): Date {
  if (opts.agingAsOf) {
    return resolveAgingAsOfDate(opts.agingAsOf);
  }
  if (opts.endDate) {
    return resolveAgingAsOfDate(opts.endDate);
  }
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return now;
}

function sqlDayDiff(callDate: Date, agingDate: Date): number {
  const startUtc = Date.UTC(callDate.getFullYear(), callDate.getMonth(), callDate.getDate());
  const endUtc = Date.UTC(agingDate.getFullYear(), agingDate.getMonth(), agingDate.getDate());
  return Math.floor((endUtc - startUtc) / 86400000);
}

function parseCallDate(row: Record<string, unknown>): Date | null {
  const raw = row.callsdtrndate ?? row.dtrndate;
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSolved(row: Record<string, unknown>): boolean {
  return truthyOne(row.bsolved) || truthyOne(row.bfastclose) || truthyOne(row.callsolved);
}

function isFastClose(row: Record<string, unknown>): boolean {
  return truthyOne(row.bfastclose);
}

function isCancelled(row: Record<string, unknown>): boolean {
  const cancel = Number(row.ncancelreason ?? 0);
  return cancel !== 0 && cancel !== 2;
}

function isOpen(row: Record<string, unknown>): boolean {
  return !isSolved(row) && !isCancelled(row);
}

export function isPartPending(row: Record<string, unknown>): boolean {
  if (!isOpen(row)) return false;
  const remarks = String(row.vsolveremarks ?? '').toUpperCase();
  const complaint = String(row.vcomplaint ?? '').toUpperCase();
  const hasVisit = Number(row.has_visit ?? 0) === 1;
  if (remarks.includes('PART')) return true;
  if (!complaint.includes('PART')) return false;
  if (complaint.startsWith('CUT OFF, COOLING, PART PROBLEM') && !hasVisit) return false;
  return true;
}

function callTypeIs(row: Record<string, unknown>, type: string): boolean {
  return normalizeCallTypeDisplay(row.calltype) === normalizeCallTypeDisplay(type);
}

function rowOfficeId(row: Record<string, unknown>): number {
  return resolveMainBranchOfficeId(row);
}

function rowParentId(_row: Record<string, unknown>): number {
  return 0;
}

function rowBranchName(row: Record<string, unknown>): string {
  return resolveMainBranchDisplayName(row);
}

function rowRegion(row: Record<string, unknown>): string {
  return String(row.region ?? 'OTHER').toUpperCase();
}

function rowAccount(row: Record<string, unknown>): string {
  return String(row.account ?? 'UNCLASSIFIED');
}

function rowHeadcount(row: Record<string, unknown>): number {
  return Number(row.branch_headcount ?? 0);
}

function rowTechnician(row: Record<string, unknown>): string {
  return String(row.technician_name ?? row.serviceman ?? '').trim();
}

export type SummaryDiagnostic = {
  corpusCallCount: number;
  eligibleCalls: number;
  afterOfficeFilter: number;
  afterCallTypeFilter: number;
  aggregatedBranches: number;
  aggregatedAccounts: number;
  officeIdsParam: string;
  callTypesParam: string;
  sampleOfficeIds: string[];
  missingOfficeIdCount: number;
  missingRegionCount: number;
};

/** Counts how many corpus rows survive each summary filter stage (for debugging empty dashboards). */
export function diagnoseSummaryDerivation(
  calls: Record<string, unknown>[],
  opts: DeriveSummaryOptions = {}
): SummaryDiagnostic {
  let eligibleCalls = 0;
  let afterOfficeFilter = 0;
  let afterCallTypeFilter = 0;
  const sampleOfficeIds = new Set<string>();
  let missingOfficeIdCount = 0;
  let missingRegionCount = 0;

  for (const row of calls) {
    if (row.officeId == null && row.nofficeid == null) missingOfficeIdCount += 1;
    if (row.region == null || String(row.region).trim() === '') missingRegionCount += 1;
    if (!isSummaryEligibleCall(row)) continue;
    eligibleCalls += 1;
    if (!matchesOfficeFilter(row, opts.officeIdsParam)) continue;
    afterOfficeFilter += 1;
    sampleOfficeIds.add(String(row.officeId ?? row.nofficeid ?? ''));
    if (!matchesCallTypeFilter(row, opts.callTypesParam)) continue;
    afterCallTypeFilter += 1;
  }

  const derived = deriveSummaryDashboard(calls, opts);

  return {
    corpusCallCount: calls.length,
    eligibleCalls,
    afterOfficeFilter,
    afterCallTypeFilter,
    aggregatedBranches: derived.branchSummary.length,
    aggregatedAccounts: derived.accountSummary.length,
    officeIdsParam: opts.officeIdsParam ?? 'All',
    callTypesParam: opts.callTypesParam ?? 'All',
    sampleOfficeIds: Array.from(sampleOfficeIds).slice(0, 10),
    missingOfficeIdCount,
    missingRegionCount,
  };
}

export function deriveSummaryDashboard(
  calls: Record<string, unknown>[],
  opts: DeriveSummaryOptions = {}
): SummaryDashboard {
  const agingDate = resolveAgingDate(opts);
  const branchMap = new Map<number, BranchSummaryRow & { active_eng_names: Set<string> }>();
  const accountMap = new Map<string, AccountSummaryRow & { active_eng_names: Set<string> }>();
  const regionHeadcountMap = new Map<string, number>();

  for (const row of calls) {
    if (!isSummaryEligibleCall(row)) continue;
    if (!matchesOfficeFilter(row, opts.officeIdsParam)) continue;
    if (!matchesCallTypeFilter(row, opts.callTypesParam)) continue;

    const officeId = rowOfficeId(row);
    const region = rowRegion(row);
    const account = rowAccount(row);
    const headcount = rowHeadcount(row);
    const technician = rowTechnician(row);
    const isBd = callTypeIs(row, BREAKDOWN);
    const isDep = callTypeIs(row, DEPLOYMENT);
    const isIns = callTypeIs(row, INSTALLATION);
    const open = isOpen(row);
    const solved = isSolved(row);
    const cancelled = isCancelled(row);
    const partPending = isPartPending(row);
    const callDate = parseCallDate(row);
    const dayDiff = callDate ? sqlDayDiff(callDate, agingDate) : null;

    if (!branchMap.has(officeId)) {
      branchMap.set(officeId, {
        officeId,
        parentId: rowParentId(row),
        branch: rowBranchName(row),
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
        all_total: 0,
        all_solved: 0,
        all_cancelled: 0,
        all_open: 0,
        all_age_2: 0,
        all_age_3: 0,
        all_age_7: 0,
        all_age_15: 0,
        all_part_pending: 0,
        all_tech_solved: 0,
        tech_solved_calls: 0,
        deployment_total: 0,
        deployment_done: 0,
        installation_total: 0,
        installation_done: 0,
        active_eng: 0,
        population: 0,
        headcount,
        active_eng_names: new Set<string>(),
      });
      const currentHc = regionHeadcountMap.get(region) || 0;
      regionHeadcountMap.set(region, currentHc + headcount);
    } else if (headcount > branchMap.get(officeId)!.headcount) {
      const branchRow = branchMap.get(officeId)!;
      const delta = headcount - branchRow.headcount;
      branchRow.headcount = headcount;
      regionHeadcountMap.set(region, (regionHeadcountMap.get(region) || 0) + delta);
    }

    const b = branchMap.get(officeId)!;
    const branchLabel = rowBranchName(row);
    if (branchLabel !== 'UNKNOWN' && (b.branch === 'UNKNOWN' || b.branch === '')) {
      b.branch = branchLabel;
    }
    b.population += 1;
    b.total_calls += 1;
    if (solved) b.solved_calls += 1;
    if (isFastClose(row)) b.all_tech_solved += 1;
    if (isBd && isFastClose(row)) b.tech_solved_calls += 1;
    if (cancelled) b.cancelled_calls += 1;
    if (open) b.open_calls += 1;
    if (open && dayDiff != null) {
      incrementAgingBucket(b, dayDiff);
    }
    if (partPending) b.part_pending += 1;

    if (isDep) {
      b.deployment_total += 1;
      if (solved) b.deployment_done += 1;
    }
    if (isIns) {
      b.installation_total += 1;
      if (solved) b.installation_done += 1;
    }
    if (technician) b.active_eng_names.add(technician);

    const accountKey = `${region}-${account}`;
    if (!accountMap.has(accountKey)) {
      accountMap.set(accountKey, {
        region,
        account,
        population: 0,
        total_calls: 0,
        total_solved: 0,
        cancelled_calls: 0,
        open_calls: 0,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        deployment_total: 0,
        deployment_done: 0,
        installation_total: 0,
        installation_done: 0,
        active_eng: 0,
        headcount: 0,
        total_tech_solved: 0,
        active_eng_names: new Set<string>(),
      });
    }

    const a = accountMap.get(accountKey)!;
    a.population += 1;
    if (isBd) {
      a.total_calls += 1;
      if (solved) a.total_solved += 1;
      if (isFastClose(row)) a.total_tech_solved += 1;
      if (cancelled) a.cancelled_calls += 1;
      if (open) a.open_calls += 1;
      if (open && dayDiff != null) {
        incrementAgingBucket(a, dayDiff);
      }
      if (partPending) a.part_pending += 1;
    }
    if (isDep) {
      a.deployment_total += 1;
      if (solved) a.deployment_done += 1;
    }
    if (isIns) {
      a.installation_total += 1;
      if (solved) a.installation_done += 1;
    }
    if (technician) a.active_eng_names.add(technician);
  }

  const branchSummary = Array.from(branchMap.values()).map(({ active_eng_names, ...rest }) => {
    const agingOpen = openCallsFromAging(rest);
    return {
      ...rest,
      open_calls: agingOpen > 0 ? agingOpen : rest.open_calls,
      all_open: agingOpen > 0 ? agingOpen : rest.all_open,
      active_eng: active_eng_names.size,
    };
  });

  const accountSummary = Array.from(accountMap.values()).map(({ active_eng_names, ...rest }) => {
    const agingOpen = openCallsFromAging(rest);
    return {
      ...rest,
      open_calls: agingOpen > 0 ? agingOpen : rest.open_calls,
      active_eng: active_eng_names.size,
      headcount: regionHeadcountMap.get(rest.region) || 0,
    };
  });

  const globalHeadcount = Array.from(regionHeadcountMap.values()).reduce((sum, val) => sum + val, 0);

  return { branchSummary, accountSummary, globalHeadcount };
}
