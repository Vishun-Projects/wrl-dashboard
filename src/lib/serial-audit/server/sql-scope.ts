import { postQuery } from '@/lib/db/proxy';
import type { SerialAuditSqlOpts } from '@/lib/trhcalls/query';

const OFFICE_EXPAND_TTL_MS = 30 * 60 * 1000;
const officeExpandCache = new Map<string, { ids: string[]; timestamp: number }>();

function parseCsvIds(param: string | null | undefined): string[] {
  if (!param || param === 'All') return [];
  return [...new Set(param.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** One lightweight CRM query — avoids per-row mstoffice subqueries on trhcalls. */
export async function expandMstOfficeIds(roots: string[]): Promise<string[]> {
  const uniqueRoots = [...new Set(roots.map((r) => String(r).trim()).filter(Boolean))];
  if (uniqueRoots.length === 0) return [];

  const cacheKey = uniqueRoots.slice().sort().join(',');
  const cached = officeExpandCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < OFFICE_EXPAND_TTL_MS) {
    return cached.ids;
  }

  const list = uniqueRoots.map((r) => `'${r.replace(/'/g, "''")}'`).join(',');
  const res = await postQuery({
    rawSql: `SELECT ncode FROM mstoffice (NOLOCK) WHERE ncode IN (${list}) OR nunder IN (${list})`,
    timeoutMs: 20000,
  });

  const ids = new Set(uniqueRoots);
  for (const row of (res.data || []) as { ncode?: unknown }[]) {
    const id = String(row.ncode ?? '').trim();
    if (id) ids.add(id);
  }

  const expanded = [...ids];
  officeExpandCache.set(cacheKey, { ids: expanded, timestamp: Date.now() });
  return expanded;
}

export type SerialAuditScopeInput = {
  callType: string;
  repair: string;
  branch: string;
  franchisee: string;
  startDate: string | null;
  endDate: string | null;
  isHod: boolean;
  assignedOffices: string[];
};

/** Resolve branch / security office filters to flat IN lists for fast SQL. */
export async function resolveSerialAuditSqlOpts(
  scope: SerialAuditScopeInput
): Promise<SerialAuditSqlOpts> {
  const branchRoots = parseCsvIds(scope.branch);
  const assignedRoots = scope.isHod ? [] : scope.assignedOffices;

  let branchOfficeIds: string[] | undefined;
  let assignedOfficeIds: string[] | undefined;

  if (branchRoots.length > 0) {
    branchOfficeIds = await expandMstOfficeIds(branchRoots);
  }
  if (assignedRoots.length > 0) {
    assignedOfficeIds = await expandMstOfficeIds(assignedRoots);
  }

  if (branchOfficeIds?.length && assignedOfficeIds?.length) {
    const allowed = new Set(assignedOfficeIds);
    branchOfficeIds = branchOfficeIds.filter((id) => allowed.has(id));
  }
  if (branchRoots.length > 0 && branchOfficeIds?.length === 0) {
    branchOfficeIds = ['-1'];
  }

  return {
    callType: scope.callType,
    repair: scope.repair,
    franchisee: scope.franchisee || null,
    startDate: scope.startDate,
    endDate: scope.endDate,
    isHod: scope.isHod,
    assignedOffices: scope.assignedOffices,
    branchOfficeIds,
    assignedOfficeIds,
  };
}
