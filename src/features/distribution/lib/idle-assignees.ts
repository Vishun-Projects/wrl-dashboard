import { buildFranchiseeOptions, filterCallsCSR } from '@/features/report';
import type { RegisterViewFilterParts } from '@/features/report';
import {
  classifyRegisterRowStatus,
  type RegisterSummaryBucket,
} from '@/features/report';
import { looksLikeBranchOffice } from '@/lib/trhcalls/query';

export type IdleAssigneeIssue = 'assigned_no_completions' | 'zero_allocations';

export type IdleAssigneeRow = {
  assigneeType: 'technician' | 'sf';
  code: string;
  name: string;
  /** WRL branch office for technicians; parent branch for SF where known */
  branchName: string;
  issue: IdleAssigneeIssue;
  assignedCalls: number;
  totalCalls: number;
  /** ASP / franchisee office (technicians only) */
  franchiseeName?: string;
  /** ASP office id — links technician rows to franchisee capacity table */
  franchiseeCode?: string;
};

export type RosterTechnician = {
  ncode: string;
  vname: string;
  nofficeid?: string;
};

export type RosterFranchisee = {
  ncode: string;
  vcompanyname: string;
};

type AssigneeCounts = {
  name: string;
  worked: number;
  assigned: number;
  total: number;
  franchiseeName?: string;
  franchiseeCode?: string;
  franchiseeCodeCounts: Map<string, number>;
  branchCounts: Map<string, number>;
};

type OfficeRow = {
  ncode: number | string;
  vcompanyname: string;
  nunder?: number | string | null;
};

function branchLabelFromCallRow(row: Record<string, unknown>): string {
  const candidates = [
    row.resolved_branch_name,
    row.officename,
    row.branch_office_name,
    row.office_name,
  ];
  for (const raw of candidates) {
    const label = String(raw ?? '').trim();
    if (label && label !== 'UNKNOWN') return label;
  }
  return '';
}

function pickDominantCode(counts: Map<string, number>): string {
  let best = '';
  let bestN = 0;
  for (const [code, n] of counts) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  return best;
}

function pickDominantBranch(counts: Map<string, number>): string {
  let best = '';
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}

/** Map any office id → WRL branch name (parent branch when office is ASP/franchisee). */
export function buildBranchByOfficeId(offices: OfficeRow[]): Map<string, string> {
  const byCode = new Map<string, OfficeRow>();
  for (const office of offices) {
    byCode.set(String(office.ncode), office);
  }

  const branchByOfficeId = new Map<string, string>();
  for (const office of offices) {
    const code = String(office.ncode);
    const name = String(office.vcompanyname ?? '').trim();
    if (!name) continue;

    if (looksLikeBranchOffice(name)) {
      branchByOfficeId.set(code, name);
      continue;
    }

    const parentId = office.nunder != null && String(office.nunder) !== '0' ? String(office.nunder) : '';
    if (parentId) {
      const parent = byCode.get(parentId);
      const parentName = String(parent?.vcompanyname ?? '').trim();
      if (parentName) {
        branchByOfficeId.set(code, parentName);
      }
    }
  }
  return branchByOfficeId;
}

function resolveTechBranchFromRoster(
  nofficeid: string | undefined,
  branchByOfficeId: Map<string, string>
): string {
  if (!nofficeid) return '';
  return branchByOfficeId.get(String(nofficeid)) ?? '';
}

function resolveSfBranch(code: string, branchByOfficeId: Map<string, string>): string {
  return branchByOfficeId.get(String(code)) ?? '';
}

export type IdleAssigneeKpis = {
  assignedNoCompletions: number;
  zeroAllocations: number;
};

export function isWorkedBucket(bucket: RegisterSummaryBucket): boolean {
  return bucket === 'closed' || bucket === 'techSolved';
}

function isValidEngineerId(value: unknown): boolean {
  if (value == null || value === '') return false;
  const s = String(value).trim();
  return s !== '0' && s !== '';
}

function techKey(row: Record<string, unknown>): string | null {
  if (!isValidEngineerId(row.nengineer)) return null;
  return String(row.nengineer);
}

function sfKey(row: Record<string, unknown>): string | null {
  const code = row.franchisee_code;
  if (code == null || String(code).trim() === '' || String(code) === 'UNASSIGNED') return null;
  return String(code);
}

function technicianNameFromCallRow(row: Record<string, unknown>): string {
  const name = String(
    row.technician_name ?? row.serviceman ?? row.engineer_name ?? ''
  ).trim();
  return name && name !== 'UNKNOWN' ? name : '';
}

function resolveTechnicianName(
  code: string,
  fromCalls: string,
  rosterByCode: Map<string, RosterTechnician>
): string {
  if (fromCalls && fromCalls !== 'UNKNOWN') return fromCalls;
  const rosterName = String(rosterByCode.get(code)?.vname ?? '').trim();
  if (rosterName && rosterName !== 'UNKNOWN') return rosterName;
  return fromCalls || 'UNKNOWN';
}

function ensureCounts(map: Map<string, AssigneeCounts>, key: string, name: string): AssigneeCounts {
  let entry = map.get(key);
  if (!entry) {
    entry = {
      name,
      worked: 0,
      assigned: 0,
      total: 0,
      branchCounts: new Map(),
      franchiseeCodeCounts: new Map(),
    };
    map.set(key, entry);
  } else {
    if (!entry.branchCounts) entry.branchCounts = new Map();
    if (!entry.franchiseeCodeCounts) entry.franchiseeCodeCounts = new Map();
  }
  if (name && name !== 'UNKNOWN' && entry.name === 'UNKNOWN') {
    entry.name = name;
  }
  return entry;
}

export function buildAssigneeActivity(calls: Record<string, unknown>[]): {
  technicians: Map<string, AssigneeCounts>;
  franchisees: Map<string, AssigneeCounts>;
} {
  const technicians = new Map<string, AssigneeCounts>();
  const franchisees = new Map<string, AssigneeCounts>();

  for (const row of calls) {
    const bucket = classifyRegisterRowStatus(row);
    if (bucket === 'transferred') continue;

    const techId = techKey(row);
    if (techId) {
      const techName = technicianNameFromCallRow(row) || 'UNKNOWN';
      const entry = ensureCounts(technicians, techId, techName);
      entry.total++;
      if (bucket === 'assigned') entry.assigned++;
      if (isWorkedBucket(bucket)) entry.worked++;
      const franchiseeName = String(row.franchisee_name ?? '').trim();
      if (franchiseeName && franchiseeName !== 'Unallocated') {
        entry.franchiseeName = franchiseeName;
      }
      const fCode = sfKey(row);
      if (fCode) {
        entry.franchiseeCodeCounts.set(fCode, (entry.franchiseeCodeCounts.get(fCode) ?? 0) + 1);
      }
      const branch = branchLabelFromCallRow(row);
      if (branch) {
        entry.branchCounts.set(branch, (entry.branchCounts.get(branch) ?? 0) + 1);
      }
    }

    const fCode = sfKey(row);
    if (fCode) {
      const fName = String(row.franchisee_name ?? fCode).trim() || fCode;
      const entry = ensureCounts(franchisees, fCode, fName);
      entry.total++;
      if (bucket === 'assigned') entry.assigned++;
      if (isWorkedBucket(bucket)) entry.worked++;
      const branch = branchLabelFromCallRow(row);
      if (branch) {
        entry.branchCounts.set(branch, (entry.branchCounts.get(branch) ?? 0) + 1);
      }
    }
  }

  return { technicians, franchisees };
}

export function buildIdleAssigneeKpis(rows: IdleAssigneeRow[]): IdleAssigneeKpis {
  let assignedNoCompletions = 0;
  let zeroAllocations = 0;
  for (const row of rows) {
    if (row.issue === 'assigned_no_completions') assignedNoCompletions++;
    else zeroAllocations++;
  }
  return { assignedNoCompletions, zeroAllocations };
}

/** Idle audit ignores technician/status/pincode toolbar filters so the table is not emptied on row drill-down. */
export function buildAuditScopeFilterParts(parts: RegisterViewFilterParts): RegisterViewFilterParts {
  return {
    ...parts,
    selectedTechnician: [],
    selectedStatus: [],
    pincodeSearch: '',
    priorityFilter: [],
    portalFilter: [],
    repairFilter: [],
  };
}

export function rowMatchesAuditScope(
  row: Record<string, unknown>,
  parts: RegisterViewFilterParts
): boolean {
  const csr = filterCallsCSR([row as Record<string, unknown>], {
    state: parts.selectedState,
    city: parts.selectedCity,
    selectedBranch: parts.selectedBranch,
    selectedFranchisee: parts.selectedFranchisee,
    selectedOfficeIds: parts.selectedOfficeIds,
    technician: [],
    pincodeSearch: '',
  });
  if (csr.length === 0) return false;

  if (parts.selectedCallTypes.length > 0) {
    const callType = String(row.call_type ?? row.calltype ?? row.CallType ?? '').trim();
    if (!parts.selectedCallTypes.includes(callType)) return false;
  }

  return true;
}

/** Technicians seen on calls in audit scope (for merging with branch roster). */
export function buildTechniciansSeenOnCalls(
  calls: Record<string, unknown>[]
): Map<string, RosterTechnician> {
  const map = new Map<string, RosterTechnician>();
  for (const row of calls) {
    const id = techKey(row);
    if (!id) continue;
    const name = technicianNameFromCallRow(row) || id;
    const nofficeid =
      row.technician_office_id != null ? String(row.technician_office_id) : undefined;
    map.set(id, { ncode: id, vname: name, nofficeid });
  }
  return map;
}

/** SF + technicians: assigned backlog with no work, or roster with zero calls in period. */
export function buildIdleAssigneeRows(params: {
  auditScopeCalls: Record<string, unknown>[];
  rosterTechnicians: RosterTechnician[];
  rosterFranchisees: RosterFranchisee[];
  offices?: OfficeRow[];
}): IdleAssigneeRow[] {
  const { auditScopeCalls, rosterTechnicians, rosterFranchisees, offices = [] } = params;
  const { technicians, franchisees } = buildAssigneeActivity(auditScopeCalls);
  const branchByOfficeId = buildBranchByOfficeId(offices);
  const rosterByCode = new Map<string, RosterTechnician>();
  for (const tech of rosterTechnicians) {
    rosterByCode.set(String(tech.ncode), tech);
  }
  const rows: IdleAssigneeRow[] = [];
  const seen = new Set<string>();

  const pushRow = (row: IdleAssigneeRow) => {
    const dedupeKey = `${row.assigneeType}:${row.code}:${row.issue}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    rows.push(row);
  };

  for (const [code, counts] of technicians) {
    if (counts.assigned > 0 && counts.worked === 0) {
      pushRow({
        assigneeType: 'technician',
        code,
        name: resolveTechnicianName(code, counts.name, rosterByCode),
        branchName: pickDominantBranch(counts.branchCounts),
        issue: 'assigned_no_completions',
        assignedCalls: counts.assigned,
        totalCalls: counts.total,
        franchiseeName: counts.franchiseeName,
        franchiseeCode: pickDominantCode(counts.franchiseeCodeCounts),
      });
    }
  }

  for (const [code, counts] of franchisees) {
    if (counts.assigned > 0 && counts.worked === 0) {
      pushRow({
        assigneeType: 'sf',
        code,
        name: counts.name,
        branchName: pickDominantBranch(counts.branchCounts) || resolveSfBranch(code, branchByOfficeId),
        issue: 'assigned_no_completions',
        assignedCalls: counts.assigned,
        totalCalls: counts.total,
        franchiseeCode: code,
      });
    }
  }

  for (const tech of rosterTechnicians) {
    const code = String(tech.ncode);
    const activity = technicians.get(code);
    const total = activity?.total ?? 0;
    if (total === 0) {
      const nofficeid = tech.nofficeid != null ? String(tech.nofficeid) : undefined;
      pushRow({
        assigneeType: 'technician',
        code,
        name: String(tech.vname || code).trim() || code,
        branchName: resolveTechBranchFromRoster(nofficeid, branchByOfficeId),
        issue: 'zero_allocations',
        assignedCalls: 0,
        totalCalls: 0,
        franchiseeCode: nofficeid,
      });
    }
  }

  for (const franchisee of rosterFranchisees) {
    const code = String(franchisee.ncode);
    const activity = franchisees.get(code);
    const total = activity?.total ?? 0;
    if (total === 0) {
      pushRow({
        assigneeType: 'sf',
        code,
        name: String(franchisee.vcompanyname || code).trim() || code,
        branchName: resolveSfBranch(code, branchByOfficeId),
        issue: 'zero_allocations',
        assignedCalls: 0,
        totalCalls: 0,
        franchiseeCode: code,
      });
    }
  }

  return rows.sort((a, b) => {
    if (a.issue !== b.issue) {
      return a.issue === 'assigned_no_completions' ? -1 : 1;
    }
    if (b.assignedCalls !== a.assignedCalls) return b.assignedCalls - a.assignedCalls;
    return a.name.localeCompare(b.name);
  });
}

/** Calls with no ASP — not a real franchisee for table linking. */
export function isUnallocatedFranchiseeCode(code: string | number | null | undefined): boolean {
  if (code == null) return true;
  const s = String(code).trim();
  return !s || s === '0' || s === 'UNASSIGNED';
}

/** Normalize office / franchisee ids for cross-table matching. */
export function normalizeOfficeCode(code: string | number | null | undefined): string {
  if (isUnallocatedFranchiseeCode(code)) return '';
  return String(code).trim();
}

/** Franchisee office id used to link an idle row to the capacity table. */
export function idleRowFranchiseeLinkCode(row: IdleAssigneeRow): string {
  return normalizeOfficeCode(row.assigneeType === 'sf' ? row.code : row.franchiseeCode);
}

/** Whether an idle row belongs to a franchisee (SF row or tech under that ASP). */
export function idleRowMatchesFranchisee(row: IdleAssigneeRow, franchiseeCode: string): boolean {
  const link = normalizeOfficeCode(franchiseeCode);
  if (!link) return false;
  return idleRowFranchiseeLinkCode(row) === link;
}

/** Limit branch roster techs to selected ASP/franchisee office(s). */
export function scopeRosterTechniciansToFilters(
  roster: RosterTechnician[],
  selectedFranchisee: string[]
): RosterTechnician[] {
  if (selectedFranchisee.length === 0) return roster;
  const franchiseeIds = new Set(selectedFranchisee.map(String));
  return roster.filter((t) => t.nofficeid && franchiseeIds.has(String(t.nofficeid)));
}

export function buildRosterFranchiseesFromOffices(
  offices: Array<{ ncode: number | string; vcompanyname: string; nunder?: number | string }>,
  selectedBranch: string[],
  selectedFranchisee: string[]
): RosterFranchisee[] {
  const options = buildFranchiseeOptions(offices, selectedBranch, []);
  const scoped =
    selectedFranchisee.length > 0
      ? options.filter((o) => selectedFranchisee.includes(o.value))
      : options;
  return scoped.map((o) => ({
    ncode: o.value,
    vcompanyname: o.label || o.value,
  }));
}

export const IDLE_ISSUE_LABELS: Record<IdleAssigneeIssue, string> = {
  assigned_no_completions: 'No completions',
  zero_allocations: 'Zero allocations',
};

export const IDLE_ISSUE_DETAIL: Record<IdleAssigneeIssue, string> = {
  assigned_no_completions: 'Has assigned calls but no closed or tech-solved work in this period',
  zero_allocations: 'On roster but no calls allocated in this period',
};
