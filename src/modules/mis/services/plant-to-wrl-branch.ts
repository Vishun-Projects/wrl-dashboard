/**
 * Map CRM/import plant labels onto WRL top-level BRANCH rows.
 *
 * SAP branch codes in the label (e.g. "1127 - …") mean the WRL branch with that
 * code (Guwahati), not a franchisee whose CRM officeId happens to equal 1127
 * (POWER REFRIGERATION under Patna). Same for 1150 → Ranchi, etc.
 */

import type { BranchSummaryRow } from '@/lib/summary/derive';
import { CLIENT_IMPORT_BRANCH_BY_OFFICE_ID } from '@/modules/mis/client-import/services/client-branch-map';

/** Shown in Excel; omitted from MIS digest Regional/Branch body. */
export const MAIL_BODY_HIDDEN_BRANCHES = new Set([
  '1155 - CHANDIGARH BRANCH',
  'AGRA BRANCH - 1160',
  'WRL GUJRAT BRANCH OFFICE',
]);

export function isMailBodyHiddenBranch(name: string): boolean {
  return MAIL_BODY_HIDDEN_BRANCHES.has(name.trim().toUpperCase().replace(/\s+/g, ' '));
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

/**
 * Roll every CRM office (incl. franchisees) into its WRL parent branch so
 * Branch body volume matches zone CRM base (not top-level-only undercount).
 */
export function rollupCrmOfficesToWrlBranches(
  branchSummary: BranchSummaryRow[]
): WrlBranchMetricRow[] {
  if (!branchSummary.length) return [];
  const byId = new Map(branchSummary.map((b) => [b.officeId, b]));
  const map = new Map<string, WrlBranchMetricRow>();
  for (const office of branchSummary) {
    const top = crmTopLevelBranch(office, byId);
    if (isMailBodyHiddenBranch(top.branch)) continue;
    const region = String(top.region || office.region || 'OTHER').toUpperCase();
    const key = `${region}::${top.branch}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        branch: top.branch,
        region,
        total_calls: Number(office.total_calls || 0),
        solved_calls: Number(office.solved_calls || 0),
        cancelled_calls: Number(office.cancelled_calls || 0),
        open_calls: Number(office.open_calls || 0),
        age_2: Number(office.age_2 || 0),
        age_3: Number(office.age_3 || 0),
        age_7: Number(office.age_7 || 0),
        age_15: Number(office.age_15 || 0),
        part_pending: Number(office.part_pending || 0),
        active_eng: Number(office.active_eng || 0),
      });
      continue;
    }
    prev.total_calls += Number(office.total_calls || 0);
    prev.solved_calls += Number(office.solved_calls || 0);
    prev.cancelled_calls += Number(office.cancelled_calls || 0);
    prev.open_calls += Number(office.open_calls || 0);
    prev.age_2 += Number(office.age_2 || 0);
    prev.age_3 += Number(office.age_3 || 0);
    prev.age_7 += Number(office.age_7 || 0);
    prev.age_15 += Number(office.age_15 || 0);
    prev.part_pending += Number(office.part_pending || 0);
    prev.active_eng = Math.max(prev.active_eng, Number(office.active_eng || 0));
  }
  return [...map.values()];
}
