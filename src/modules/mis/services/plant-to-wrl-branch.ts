/**
 * Map CRM/import plant labels onto WRL top-level BRANCH rows.
 *
 * SAP branch codes in the label (e.g. "1127 - …") mean the WRL branch with that
 * code (Guwahati), not a franchisee whose CRM officeId happens to equal 1127
 * (POWER REFRIGERATION under Patna). Same for 1150 → Ranchi, etc.
 */

import type { BranchSummaryRow } from '@/lib/summary/derive';
import { CLIENT_IMPORT_BRANCH_BY_OFFICE_ID } from '@/modules/mis/client-import/services/client-branch-map';

export type WrlBranchMetricRow = {
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
  active_eng: number;
};

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
 * Roll every CRM office (incl. franchisees) into its WRL top-level parent.
 * Mail body must not use top-level-only rows — that drops franchisee solved
 * (South/East crash vs yesterday's zone sum of all offices).
 * Opens are replaced later by the Excel overlay.
 */
export function rollupCrmOfficesToWrlBranches(
  branchSummary: BranchSummaryRow[]
): WrlBranchMetricRow[] {
  const byId = new Map(branchSummary.map((b) => [b.officeId, b]));
  const map = new Map<string, WrlBranchMetricRow>();
  for (const row of branchSummary) {
    const top = crmTopLevelBranch(row, byId);
    const region = String(top.region || row.region || 'OTHER');
    const key = `${region.toUpperCase()}::${top.branch}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        branch: top.branch,
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
      };
      map.set(key, agg);
    }
    agg.solved_calls += Number(row.solved_calls || 0);
    agg.cancelled_calls += Number(row.cancelled_calls || 0);
    agg.open_calls += Number(row.open_calls || 0);
    agg.age_2 += Number(row.age_2 || 0);
    agg.age_3 += Number(row.age_3 || 0);
    agg.age_7 += Number(row.age_7 || 0);
    agg.age_15 += Number(row.age_15 || 0);
    agg.part_pending += Number(row.part_pending || 0);
    agg.active_eng += Number(row.active_eng || 0);
    agg.total_calls = agg.solved_calls + agg.cancelled_calls + agg.open_calls;
  }
  return [...map.values()];
}

function findSapCodeTopLevelBranch(
  code: string,
  branchSummary: BranchSummaryRow[],
  byId: Map<number, BranchSummaryRow>
): BranchSummaryRow | null {
  const prefix = `${code} -`.toLowerCase();
  for (const b of branchSummary) {
    if (!isCrmTopLevelBranch(b, byId)) continue;
    const name = b.branch.trim();
    if (name.toLowerCase().startsWith(prefix) && /branch$/i.test(name)) {
      return b;
    }
  }
  return null;
}

/**
 * Map trace plant labels onto CRM top-level WRL branches.
 * "1127 - POWER REFRIGERATION" → Guwahati (SAP 1127), not Patna via officeId 1127.
 * Bare "POWER REFRIGERATION" still walks the CRM parent tree (Patna).
 */
export function resolveTracePlantToWrlBranch(
  plant: string,
  region: string,
  branchSummary: BranchSummaryRow[] | undefined
): { branch: string; region: string } | null {
  const label = plant.trim();
  if (!branchSummary?.length) {
    return { branch: label || '—', region };
  }
  if (!label || label === '—') return null;

  const byId = new Map(branchSummary.map((b) => [b.officeId, b]));
  const byName = new Map(branchSummary.map((b) => [b.branch.trim().toLowerCase(), b]));

  // SAP code in the label wins over CRM officeId collisions (1127 franchisee vs Guwahati).
  const codeMatch = label.match(/^(\d+)\s*-/);
  if (codeMatch) {
    const code = codeMatch[1]!;
    const sapTop = findSapCodeTopLevelBranch(code, branchSummary, byId);
    if (sapTop) {
      return { branch: sapTop.branch, region: sapTop.region || region };
    }
    const mapped = CLIENT_IMPORT_BRANCH_BY_OFFICE_ID[code];
    if (mapped) {
      return { branch: mapped, region };
    }
  }

  const named = byName.get(label.toLowerCase());
  if (named) {
    const top = crmTopLevelBranch(named, byId);
    return { branch: top.branch, region: top.region || region };
  }

  if (codeMatch) {
    const office = byId.get(Number(codeMatch[1]));
    if (office) {
      const top = crmTopLevelBranch(office, byId);
      return { branch: top.branch, region: top.region || region };
    }
  }

  if (/^\d+\s*-\s*.+\s+BRANCH$/i.test(label)) {
    return { branch: label, region };
  }
  return null;
}
