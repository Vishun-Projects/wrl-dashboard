/**
 * Shared trhcalls query helpers — keep MIS Register and Call Distribution aligned.
 * Source table: trhcalls (deduplicated by vtrnno, latest row wins).
 */

export const TRHCALLS_EXCLUDE_TRANSFERRED =
  " AND ISNULL(tc.vtransfercallno, '') = '' AND ISNULL(CAST(tc.ncancelreason AS INT), 0) <> 2";

/** Parent office codes that are not regional branches (aligned with distribution route). */
export const TRHCALLS_PARENT_OFFICE_EXCLUDE = [605, 606, 607, 608, 612, 1, 0];

export function sqlFranchiseeCodeExpr(): string {
  const ex = TRHCALLS_PARENT_OFFICE_EXCLUDE.join(', ');
  return `CASE 
    WHEN o.nunder NOT IN (${ex}) AND o.nunder IS NOT NULL AND o.nunder <> 0 THEN o.ncode 
    WHEN f.ncode IS NOT NULL AND ISNULL(f.ncode, 0) <> ISNULL(o.ncode, 0) THEN f.ncode
    WHEN transferoffice.ncode IS NOT NULL THEN transferoffice.ncode
    ELSE NULL 
  END`;
}

export function sqlFranchiseeNameExpr(): string {
  const ex = TRHCALLS_PARENT_OFFICE_EXCLUDE.join(', ');
  return `CASE 
    WHEN o.nunder NOT IN (${ex}) AND o.nunder IS NOT NULL AND o.nunder <> 0 THEN o.vcompanyname 
    WHEN f.ncode IS NOT NULL AND ISNULL(f.ncode, 0) <> ISNULL(o.ncode, 0) AND ISNULL(f.vcompanyname, '') <> '' THEN f.vcompanyname
    WHEN transferoffice.ncode IS NOT NULL AND ISNULL(transferoffice.vcompanyname, '') <> '' THEN transferoffice.vcompanyname
    ELSE 'Unallocated' 
  END`;
}

/** SQL WHERE fragment — franchisee filter values are mstoffice.ncode ids, not only ntransfertooffice. */
export function buildFranchiseeFilterSqlCondition(
  franchiseeParam: string,
  tableAlias = 'tc'
): string {
  const franchisees = franchiseeParam.split(',').map((f) => f.trim()).filter(Boolean);
  if (franchisees.length === 0 || franchiseeParam === 'All') return '';

  const assigned = franchisees.filter((f) => f !== 'UNASSIGNED');
  const includeUnassigned = franchisees.includes('UNASSIGNED');
  const codeExpr = sqlFranchiseeCodeExpr();
  const parts: string[] = [];

  if (assigned.length > 0) {
    const list = assigned.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
    parts.push(`${tableAlias}.nofficeid IN (${list})`);
    parts.push(`(${codeExpr}) IN (${list})`);
    parts.push(`${tableAlias}.ntransfertooffice IN (${list})`);
  }
  if (includeUnassigned) {
    parts.push(`(${codeExpr}) IS NULL`);
  }

  if (parts.length === 0) return '';
  return ` AND (${parts.join(' OR ')})`;
}

/** WRL branch offices are named like "1173 - DELHI BRANCH". Other offices are franchisees. */
export function looksLikeBranchOffice(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  if (!normalized) return false;
  return /\bBRANCH\b/.test(normalized) || /^\d+\s*-/.test(normalized);
}

function isUsableFranchiseeName(candidate: string, officeName: string): boolean {
  const name = candidate.trim();
  if (!name || name === 'Unallocated') return false;
  if (looksLikeBranchOffice(name)) return false;
  if (officeName && name.toLowerCase() === officeName.toLowerCase()) return false;
  return true;
}

function inferFranchiseeFromRow(row: Record<string, unknown>, officeName: string, officeIsBranch: boolean) {
  let franchiseeName = String(row.franchisee_name ?? 'Unallocated').trim();
  let franchiseeCode =
    row.franchisee_code != null && String(row.franchisee_code) !== '' && String(row.franchisee_code) !== 'null'
      ? String(row.franchisee_code)
      : 'UNASSIGNED';

  if (isUsableFranchiseeName(franchiseeName, officeName)) {
    return { franchiseeName, franchiseeCode };
  }

  const techOffice = String(row.technician_office_name ?? '').trim();
  if (isUsableFranchiseeName(techOffice, officeName)) {
    return {
      franchiseeName: techOffice,
      franchiseeCode: String(row.technician_office_id ?? franchiseeCode),
    };
  }

  const transferOffice = String(row.transfer_office_name ?? row.vtransferofficename ?? '').trim();
  if (isUsableFranchiseeName(transferOffice, officeName)) {
    return {
      franchiseeName: transferOffice,
      franchiseeCode: String(row.ntransfertooffice ?? franchiseeCode),
    };
  }

  if (!officeIsBranch && officeName && franchiseeName === 'Unallocated') {
    return {
      franchiseeName: officeName,
      franchiseeCode: String(row.nofficeid ?? franchiseeCode),
    };
  }

  return { franchiseeName: 'Unallocated', franchiseeCode };
}

export function resolveBranchFranchisee(row: Record<string, unknown>) {
  const officeUnder = Number(row.office_under || 0);
  const officeName = String(row.office_name ?? row.officename ?? '').trim();
  const branchOfficeName = String(row.branch_office_name ?? '').trim();

  const officeIsBranch = looksLikeBranchOffice(officeName);
  let { franchiseeName, franchiseeCode } = inferFranchiseeFromRow(row, officeName, officeIsBranch);

  const isUnderBranch =
    row.office_under != null &&
    row.office_under !== '' &&
    !TRHCALLS_PARENT_OFFICE_EXCLUDE.includes(officeUnder);

  const hasParentBranch =
    !!branchOfficeName &&
    !!officeName &&
    branchOfficeName.toLowerCase() !== officeName.toLowerCase();

  const parentIsBranch = looksLikeBranchOffice(branchOfficeName);

  let branchName = officeName;
  let branchCode = String(row.nofficeid ?? '');

  if (officeIsBranch) {
    branchName = officeName;
    branchCode = String(row.nofficeid ?? '');
  } else if (hasParentBranch && parentIsBranch) {
    branchName = branchOfficeName;
    branchCode = String(row.office_under ?? row.nofficeid ?? '');
    if (franchiseeName === 'Unallocated') {
      franchiseeName = officeName;
      franchiseeCode = String(row.nofficeid ?? franchiseeCode);
    }
  } else if (isUnderBranch && branchOfficeName) {
    branchName = branchOfficeName;
    branchCode = String(row.office_under);
    if (franchiseeName === 'Unallocated') {
      franchiseeName = officeName;
      franchiseeCode = String(row.nofficeid ?? franchiseeCode);
    }
  }

  // SQL franchisee via technician while call office is the franchisee entity
  if (
    franchiseeName !== 'Unallocated' &&
    !officeIsBranch &&
    hasParentBranch &&
    parentIsBranch &&
    officeName.toLowerCase() === franchiseeName.toLowerCase() &&
    branchName.toLowerCase() !== branchOfficeName.toLowerCase()
  ) {
    branchName = branchOfficeName;
    branchCode = String(row.office_under ?? branchCode);
  }

  // Guard: never show a franchisee name in the branch column when parent branch is known
  if (
    !officeIsBranch &&
    hasParentBranch &&
    parentIsBranch &&
    branchName.toLowerCase() === officeName.toLowerCase()
  ) {
    branchName = branchOfficeName;
    branchCode = String(row.office_under ?? branchCode);
    if (franchiseeName === 'Unallocated') {
      franchiseeName = officeName;
      franchiseeCode = String(row.nofficeid ?? franchiseeCode);
    }
  }

  // Technician franchisee on a branch call — keep branch office, not franchisee name
  if (
    franchiseeName !== 'Unallocated' &&
    officeIsBranch &&
    franchiseeName.toLowerCase() !== officeName.toLowerCase()
  ) {
    branchName = officeName;
    branchCode = String(row.nofficeid ?? branchCode);
  }

  // No parent branch in DB: non-branch office names are franchisees, not branches
  if (
    !officeIsBranch &&
    !hasParentBranch &&
    !isUnderBranch &&
    franchiseeName === 'Unallocated' &&
    officeName
  ) {
    franchiseeName = officeName;
    franchiseeCode = String(row.nofficeid ?? franchiseeCode);
    branchName = '';
    branchCode = 'UNKNOWN';
  }

  return {
    branchName,
    branchCode: branchCode || 'UNKNOWN',
    franchiseeName: franchiseeName || 'Unallocated',
    franchiseeCode,
  };
}

export function enrichTrhcallBranchFranchisee<T extends Record<string, unknown>>(row: T): T & {
  officename: string;
  franchisee_name: string;
  franchisee_code: string;
  resolved_branch: string;
  resolved_branch_code: string;
  resolved_branch_name: string;
} {
  const { branchName, branchCode, franchiseeName, franchiseeCode } = resolveBranchFranchisee(row);
  const displayBranch = branchName === '' ? '' : branchName || 'UNKNOWN';
  return {
    ...row,
    officename: displayBranch,
    franchisee_name: franchiseeName,
    franchisee_code: franchiseeCode,
    resolved_branch: displayBranch,
    resolved_branch_code: branchCode,
    resolved_branch_name: displayBranch,
  };
}

export function buildTrhcallsDeltaSubquery(
  lastSync: string,
  startDate?: string | null,
  endDate?: string | null
): string {
  const lastSyncSafe = lastSync.replace(/'/g, "''");
  let condition = `WHERE ISNULL(editedon, addedon) >= '${lastSyncSafe}'`;
  if (startDate) {
    condition += ` AND dtrndate >= '${startDate.replace(/'/g, "''")}'`;
  }
  if (endDate) {
    condition += ` AND dtrndate <= '${endDate.replace(/'/g, "''")} 23:59:59'`;
  }

  return `(
    SELECT *
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
          ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
        ) as rn
      FROM trhcalls (NOLOCK)
      ${condition}
    ) s
    WHERE s.rn = 1
  ) tc`;
}

/** Date window for raw trhcalls (no table alias). */
export function buildTrhcallsDateRangeWhere(opts: {
  startDate?: string | null;
  endDate?: string | null;
  column?: RegisterDateFilterColumn;
  fallbackDays?: number;
}): string {
  const col = opts.column || 'dtrndate';
  const parts: string[] = [];
  if (opts.startDate) {
    parts.push(`${col} >= '${opts.startDate.replace(/'/g, "''")}'`);
  } else if (opts.fallbackDays != null) {
    parts.push(`${col} >= DATEADD(day, -${opts.fallbackDays}, GETDATE())`);
  }
  if (opts.endDate) {
    parts.push(`${col} <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`);
  }
  return parts.join(' AND ');
}

/** Columns required by distribution map + dedup — avoids SELECT * OOM on DB proxy. */
const TRHCALLS_DEDUP_INNER_COLUMNS = [
  'vtrnno',
  'ncode',
  'editedon',
  'addedon',
  'dtrndate',
  'dsolvedatetime',
  'vcclid',
  'ncancelreason',
  'ntransfertooffice',
  'vserialno',
  'vtransfercallno',
  'bsolved',
  'bfastclose',
  'nengineer',
  'nofficeid',
  'nparty',
  'ncalltype',
].join(', ');

export function buildTrhcallsDedupSubquery(opts?: {
  startDate?: string | null;
  endDate?: string | null;
}): string {
  const dateWhere = buildTrhcallsDateRangeWhere({
    startDate: opts?.startDate,
    endDate: opts?.endDate,
    fallbackDays: 30,
  });
  const subqueryCondition = `WHERE ${dateWhere}`;

  return `(
    SELECT *
    FROM (
      SELECT ${TRHCALLS_DEDUP_INNER_COLUMNS},
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
          ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
        ) as rn
      FROM trhcalls (NOLOCK)
      ${subqueryCondition}
    ) s
    WHERE s.rn = 1
  ) tc`;
}

/** Exact TRN pattern — e.g. 26C17585 */
export function normalizeExactTrnSearch(search: string): string | null {
  const cleaned = search.trim().replace(/-/g, '');
  if (/^[A-Za-z0-9]{3}\d{2}\d+$/.test(cleaned)) {
    return cleaned.replace(/'/g, "''");
  }
  return null;
}

/** trhcalls TRN columns may be int or varchar — always compare as varchar. */
function castTrhcallTrnColumn(column: string): string {
  return `CAST(${column} AS VARCHAR(50))`;
}

function buildRawTrnExactMatch(exactTrn: string): string {
  return `(${castTrhcallTrnColumn('vtrnno')} = '${exactTrn}' OR ${castTrhcallTrnColumn('vcclid')} = '${exactTrn}' OR ${castTrhcallTrnColumn('vtransfercallno')} = '${exactTrn}' OR CAST(ncode AS VARCHAR(50)) = '${exactTrn}' OR vserialno = '${exactTrn}')`;
}

function buildRawTrnLikeMatch(searchSafe: string): string {
  return `(${castTrhcallTrnColumn('vtrnno')} LIKE '%${searchSafe}%' OR ${castTrhcallTrnColumn('vcclid')} LIKE '%${searchSafe}%' OR ${castTrhcallTrnColumn('vtransfercallno')} LIKE '%${searchSafe}%' OR CAST(ncode AS VARCHAR(50)) LIKE '%${searchSafe}%' OR vserialno LIKE '%${searchSafe}%')`;
}

function buildAliasedTrnExactMatch(exactTrn: string): string {
  return `(${castTrhcallTrnColumn('tc.vtrnno')} = '${exactTrn}' OR ${castTrhcallTrnColumn('tc.vcclid')} = '${exactTrn}' OR ${castTrhcallTrnColumn('tc.vtransfercallno')} = '${exactTrn}' OR CAST(tc.ncode AS VARCHAR(50)) = '${exactTrn}' OR tc.vserialno = '${exactTrn}')`;
}

function buildAliasedTrnLikeMatch(searchSafe: string): string {
  return `(${castTrhcallTrnColumn('tc.vtrnno')} LIKE '%${searchSafe}%' OR ${castTrhcallTrnColumn('tc.vcclid')} LIKE '%${searchSafe}%' OR ${castTrhcallTrnColumn('tc.vtransfercallno')} LIKE '%${searchSafe}%' OR CAST(tc.ncode AS VARCHAR(50)) LIKE '%${searchSafe}%' OR tc.vserialno LIKE '%${searchSafe}%')`;
}

function buildRawNumericIdMatch(idSafe: string): string {
  return `(CAST(ncode AS VARCHAR(50)) = '${idSafe}' OR ${castTrhcallTrnColumn('vtrnno')} LIKE '%${idSafe}%' OR ${castTrhcallTrnColumn('vcclid')} LIKE '%${idSafe}%' OR vserialno LIKE '%${idSafe}%')`;
}

function buildAliasedNumericIdMatch(idSafe: string): string {
  return `(CAST(tc.ncode AS VARCHAR(50)) = '${idSafe}' OR ${castTrhcallTrnColumn('tc.vtrnno')} LIKE '%${idSafe}%' OR ${castTrhcallTrnColumn('tc.vcclid')} LIKE '%${idSafe}%' OR tc.vserialno LIKE '%${idSafe}%')`;
}

function buildIdentifierLookupWhere(search: string, aliased: boolean): string {
  const searchSafe = search.trim().replace(/'/g, "''");
  if (!searchSafe) return '1=0';

  const exactTrn = normalizeExactTrnSearch(searchSafe);
  if (exactTrn) {
    return aliased ? buildAliasedTrnExactMatch(exactTrn) : buildRawTrnExactMatch(exactTrn);
  }

  if (/^\d+$/.test(searchSafe)) {
    return aliased ? buildAliasedNumericIdMatch(searchSafe) : buildRawNumericIdMatch(searchSafe);
  }

  return aliased ? buildAliasedTrnLikeMatch(searchSafe) : buildRawTrnLikeMatch(searchSafe);
}

/** Full-table dedup subquery scoped to a TRN/reference lookup (no date window). */
export function buildTrhcallsLookupSubquery(search: string): string {
  const lookupWhere = buildIdentifierLookupWhere(search, false);

  return `(
    SELECT *
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
          ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
        ) as rn
      FROM trhcalls (NOLOCK)
      WHERE ${lookupWhere}
    ) s
    WHERE s.rn = 1
  ) tc`;
}

export function buildTrhcallsLookupCondition(search: string): string {
  const searchSafe = search.trim().replace(/'/g, "''");
  if (!searchSafe) return '1=0';
  if (normalizeExactTrnSearch(searchSafe) || /^\d+$/.test(searchSafe) || searchSafe.length >= 3) {
    return buildIdentifierLookupWhere(search, true);
  }
  return `(${buildAliasedTrnLikeMatch(searchSafe)} OR p.vname LIKE '%${searchSafe}%' OR mstitems.vname LIKE '%${searchSafe}%' OR tc.vserialno LIKE '%${searchSafe}%' OR p.vinstpostalcode LIKE '%${searchSafe}%')`;
}

export type RegisterDateFilterColumn = 'dtrndate' | 'dsolvedatetime';

export const REGISTER_DATE_FILTER_OPTIONS: { value: RegisterDateFilterColumn; label: string }[] = [
  { value: 'dtrndate', label: 'Call Date' },
  { value: 'dsolvedatetime', label: 'Solved Date' },
];

export function resolveRegisterDateSqlColumn(column: string | null | undefined): RegisterDateFilterColumn {
  return column === 'dsolvedatetime' ? 'dsolvedatetime' : 'dtrndate';
}

export function sqlRegisterDateColumn(column: RegisterDateFilterColumn, alias = 'tc'): string {
  return `${alias}.${column}`;
}

export function appendCallTypeFilter(condition: string, callType: string | null | undefined): string {
  if (!callType || callType === 'All') return condition;

  const types = callType.split(',').map((t) => t.trim()).filter(Boolean);
  if (types.length === 1) {
    const safe = types[0].replace(/'/g, "''");
    return `${condition} AND tc.ncalltype = (SELECT TOP 1 ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue = '${safe}')`;
  }
  if (types.length > 1) {
    const typeList = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
    return `${condition} AND tc.ncalltype IN (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue IN (${typeList}))`;
  }
  return condition;
}

export function appendOfficeSecurityFilter(
  condition: string,
  isHod: boolean,
  assignedOffices: string[]
): string {
  if (isHod || assignedOffices.length === 0) return condition;
  const allowed = assignedOffices.join(',');
  return `${condition} AND (tc.nofficeid IN (${allowed}) OR o.nunder IN (${allowed}))`;
}

export function buildTrhcallsBaseCondition(opts: {
  startDate?: string | null;
  endDate?: string | null;
  dateColumn?: RegisterDateFilterColumn;
  /** When dates are already applied inside buildTrhcallsDedupSubquery */
  datesInSubquery?: boolean;
  callType?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
}): string {
  let condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
  condition = appendCallTypeFilter(condition, opts.callType);
  if (!opts.datesInSubquery) {
    const dateCol = sqlRegisterDateColumn(opts.dateColumn || 'dtrndate');
    if (opts.startDate) {
      condition += ` AND ${dateCol} >= '${opts.startDate.replace(/'/g, "''")}'`;
    }
    if (opts.endDate) {
      condition += ` AND ${dateCol} <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`;
    }
  }
  condition = appendOfficeSecurityFilter(condition, opts.isHod ?? true, opts.assignedOffices ?? []);
  return condition;
}

/** Match /api/report summary bucket logic on a raw trhcalls row. */
export function classifyTrhcallRow(row: {
  bsolved?: unknown;
  bfastclose?: unknown;
  ncancelreason?: unknown;
}): 'open' | 'solved' | 'cancelled' {
  const cancelReason = Number(row.ncancelreason || 0);
  if (cancelReason !== 0 && cancelReason !== 2) return 'cancelled';

  const isSolved =
    row.bsolved === true ||
    row.bsolved === 1 ||
    String(row.bsolved).toLowerCase() === 'true' ||
    String(row.bsolved) === '1';
  const isTechSolved =
    row.bfastclose === true ||
    row.bfastclose === 1 ||
    String(row.bfastclose).toLowerCase() === 'true' ||
    String(row.bfastclose) === '1';

  if (isSolved || isTechSolved) return 'solved';
  return 'open';
}

export function summarizeTrhcallRows(rows: Array<{ bsolved?: unknown; bfastclose?: unknown; ncancelreason?: unknown }>) {
  let total = 0;
  let open = 0;
  let solved = 0;
  let cancelled = 0;
  for (const row of rows) {
    total++;
    const bucket = classifyTrhcallRow(row);
    if (bucket === 'cancelled') cancelled++;
    else if (bucket === 'solved') solved++;
    else open++;
  }
  return { total, open, solved, cancelled };
}
