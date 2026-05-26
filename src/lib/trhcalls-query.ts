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
  'npartyprofile',
  'ncalltype',
  'nitem',
  'vcomplaint',
  'vpersoncalling',
  'callStatus',
  'vsolveremarks',
].join(', ');

export function buildTrhcallsDedupSubquery(opts?: {
  startDate?: string | null;
  endDate?: string | null;
  /** Default 30 for register/distribution; pass `null` for no fallback (corpus with explicit dates). */
  fallbackDays?: number | null;
  column?: RegisterDateFilterColumn;
}): string {
  const dateWhere = buildTrhcallsDateRangeWhere({
    startDate: opts?.startDate,
    endDate: opts?.endDate,
    column: opts?.column,
    fallbackDays:
      opts?.fallbackDays === null
        ? undefined
        : opts?.fallbackDays !== undefined
          ? opts.fallbackDays
          : 30,
  });
  const subqueryCondition = dateWhere ? `WHERE ${dateWhere}` : '';

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

/** Max rows returned by corpus API before truncated flag. */
export const CORPUS_MAX_ROWS = 50_000;

const CORPUS_CALL_STATUS_EXPR = `
  CASE
    WHEN tc.bsolved = 1 THEN 'Solved'
    WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 THEN 'Cancel'
    ELSE 'Open'
  END`;

/** Shared lightweight field list for report corpus API. */
export function buildCorpusFieldsSql(): string {
  return `
    tc.vcclid,
    tc.ncode,
    tc.ncode AS id,
    tc.ncancelreason,
    tc.ntransfertooffice,
    tc.vtrnno,
    tc.vtrnno AS UniqueCallNo,
    tc.vserialno AS callsvserialno,
    tc.vtransfercallno,
    tc.bsolved,
    tc.bfastclose,
    tc.nengineer,
    tc.nofficeid,
    o.ncode AS officeId,
    o.nunder AS parentId,
    ISNULL(UPPER(z.vname), 'OTHER') AS region,
    ISNULL(pprof.vname, 'UNCLASSIFIED') AS account,
    ISNULL(hc.branch_headcount, 0) AS branch_headcount,
    CASE WHEN EXISTS (SELECT 1 FROM trdcalls1visit v (NOLOCK) WHERE v.ncalls = tc.ncode) THEN 1 ELSE 0 END AS has_visit,
    tc.editedon,
    tc.addedon,
    p.vinstpostalcode AS Pincode,
    p.vname AS PartyName,
    p.vinsttel1 AS vinsttel1,
    p.vinstaddress AS vinstaddress,
    tc.vpersoncalling,
    cty.vname AS dbCity,
    st.vname AS dbState,
    o.nunder AS office_under,
    o.vcompanyname AS office_name,
    bo.vcompanyname AS branch_office_name,
    u.vname AS serviceman,
    u.vname AS technician_name,
    f.vcompanyname AS technician_office_name,
    f.ncode AS technician_office_id,
    transferoffice.vcompanyname AS transfer_office_name,
    ${sqlFranchiseeCodeExpr()} AS franchisee_code,
    ${sqlFranchiseeNameExpr()} AS franchisee_name,
    CONVERT(varchar(30), tc.dtrndate, 126) AS callsdtrndate,
    tc.vcomplaint,
    mstitems.vname AS itemname,
    calltype_fs.vdisplayvalue AS calltype,
    tc.callStatus AS Status,
    ${CORPUS_CALL_STATUS_EXPR} AS callstatus,
    tc.bsolved AS callsolved,
    CONVERT(varchar(30), tc.dsolvedatetime, 126) AS callsolveddate,
    tc.vsolveremarks,
    cr.vname AS cancel_reason,
    (SELECT TOP 1 r.bmajor FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) AS is_major_repair
  `;
}

export function buildCorpusDedupSubquery(opts: {
  startDate?: string | null;
  endDate?: string | null;
  lastSync?: string | null;
  dateColumn?: RegisterDateFilterColumn;
}): string {
  if (opts.lastSync) {
    return buildTrhcallsDeltaSubquery(opts.lastSync, opts.startDate, opts.endDate);
  }
  return buildTrhcallsDedupSubquery({
    startDate: opts.startDate,
    endDate: opts.endDate,
    fallbackDays: opts.startDate || opts.endDate ? null : 30,
    column: opts.dateColumn,
  });
}

export function buildCorpusTableName(opts: {
  startDate?: string | null;
  endDate?: string | null;
  lastSync?: string | null;
  dateColumn?: RegisterDateFilterColumn;
}): string {
  return `
    ${buildCorpusDedupSubquery(opts)}
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstoffice op (NOLOCK) ON o.nunder = op.ncode AND o.nunder <> 0
    LEFT JOIN mstzones z (NOLOCK) ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
    LEFT JOIN (
      SELECT nofficeid, COUNT(DISTINCT ncode) as branch_headcount
      FROM mstusers (NOLOCK)
      WHERE bactive = 'True'
      GROUP BY nofficeid
    ) hc ON o.ncode = hc.nofficeid
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
  `;
}

/** Valid device serial on raw trhcalls row (no alias). */
export const SERIAL_AUDIT_VALID_SERIAL_WHERE =
  "ISNULL(vserialno, '') <> '' AND LTRIM(RTRIM(vserialno)) NOT IN ('0', 'N/A', 'NA', 'NONE', 'NULL', '-', '—')";

/** Exclude transferred calls on raw trhcalls row (no alias). */
export const SERIAL_AUDIT_TRANSFER_EXCLUDE_WHERE =
  "ISNULL(vtransfercallno, '') = '' AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2";

export const TRHCALLS_CALL_ID_EXPR =
  "CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END";

const TRHCALLS_DEDUP_PARTITION =
  "CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END";

const TRHCALLS_DEDUP_ORDER = 'ISNULL(editedon, addedon) DESC, ncode DESC';

/** Max calendar days for a single client corpus download (wider ranges use server views per page). */
export const MAX_CLIENT_CORPUS_DAYS = 120;

function buildSerialAuditBaseWhere(opts?: {
  callType?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
  startDate?: string | null;
  endDate?: string | null;
}): string {
  let where = `${SERIAL_AUDIT_VALID_SERIAL_WHERE} AND vtrnno IS NOT NULL AND vtrnno <> '' AND ${SERIAL_AUDIT_TRANSFER_EXCLUDE_WHERE}`;
  if (opts?.startDate) {
    where += ` AND dtrndate >= '${opts.startDate.replace(/'/g, "''")}'`;
  }
  if (opts?.endDate) {
    where += ` AND dtrndate <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`;
  }
  const callTypeSubquery = buildCallTypeNcodeInSubquery(opts?.callType);
  if (callTypeSubquery) {
    where += ` AND ncalltype IN ${callTypeSubquery}`;
  }
  if (!opts?.isHod && opts?.assignedOffices && opts.assignedOffices.length > 0) {
    const allowed = opts.assignedOffices.join(',');
    where += ` AND (nofficeid IN (${allowed}) OR nofficeid IN (SELECT ncode FROM mstoffice (NOLOCK) WHERE nunder IN (${allowed})))`;
  }
  return where;
}

/** Repeated serials in a date window — deduped rows with status counts. */
export function buildSerialAuditWindowListRawSql(opts: {
  minRepeats?: number;
  callType?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
  startDate?: string | null;
  endDate?: string | null;
}): string {
  const minRepeats = Math.max(2, opts.minRepeats ?? 2);
  const where = buildSerialAuditBaseWhere(opts);

  return `
    SELECT
      UPPER(RTRIM(vserialno)) AS serial,
      COUNT(*) AS complaint_count,
      SUM(CASE
        WHEN (bsolved = 1 OR bfastclose = 1) THEN 0
        WHEN ncancelreason IS NOT NULL AND ncancelreason <> 0 AND ncancelreason <> 2 THEN 0
        ELSE 1
      END) AS open_count,
      SUM(CASE WHEN bsolved = 1 OR bfastclose = 1 THEN 1 ELSE 0 END) AS solved_count,
      SUM(CASE
        WHEN ncancelreason IS NOT NULL AND ncancelreason <> 0 AND ncancelreason <> 2 THEN 1
        ELSE 0
      END) AS cancelled_count,
      CONVERT(varchar(30), MAX(dtrndate), 126) AS last_complaint_date
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY ${TRHCALLS_DEDUP_PARTITION}
          ORDER BY ${TRHCALLS_DEDUP_ORDER}
        ) AS rn
      FROM trhcalls (NOLOCK)
      WHERE ${where}
    ) deduped
    WHERE rn = 1
    GROUP BY UPPER(RTRIM(vserialno))
    HAVING COUNT(*) >= ${minRepeats}
  `;
}

/** All-time repeated serials — single pass, no joins, no ORDER BY (sort client-side). */
export function buildSerialAuditListRawSql(opts: {
  minRepeats?: number;
  callType?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
  startDate?: string | null;
  endDate?: string | null;
}): string {
  if (opts.startDate || opts.endDate) {
    return buildSerialAuditWindowListRawSql(opts);
  }
  const minRepeats = Math.max(2, opts.minRepeats ?? 2);
  const where = buildSerialAuditBaseWhere(opts);

  return `
    SELECT
      UPPER(RTRIM(vserialno)) AS serial,
      COUNT(DISTINCT vtrnno) AS complaint_count,
      CONVERT(varchar(30), MAX(dtrndate), 126) AS last_complaint_date
    FROM trhcalls (NOLOCK)
    WHERE ${where}
    GROUP BY UPPER(RTRIM(vserialno))
    HAVING COUNT(DISTINCT vtrnno) >= ${minRepeats}
  `;
}

/** All calls for one serial — scoped dedup + minimal joins. */
export function buildSerialAuditDetailRawSql(
  serial: string,
  opts: {
    callType?: string | null;
    isHod?: boolean;
    assignedOffices?: string[];
    startDate?: string | null;
    endDate?: string | null;
  }
): string {
  const serialSafe = serial.trim().replace(/'/g, "''").toUpperCase();
  const where = `${buildSerialAuditBaseWhere(opts)} AND UPPER(LTRIM(RTRIM(vserialno))) = '${serialSafe}'`;

  return `
    SELECT TOP 100 PERCENT
      tc.vcclid,
      tc.ncode AS id,
      tc.ncode,
      tc.ncancelreason,
      tc.vtrnno,
      tc.vtrnno AS UniqueCallNo,
      tc.vserialno AS callsvserialno,
      tc.vtransfercallno,
      tc.bsolved,
      tc.bfastclose,
      tc.nengineer,
      tc.nofficeid,
      p.vinstpostalcode AS pincode,
      p.vname AS PartyName,
      o.nunder AS office_under,
      o.vcompanyname AS office_name,
      bo.vcompanyname AS branch_office_name,
      u.vname AS serviceman,
      u.vname AS technician_name,
      CONVERT(varchar(30), tc.dtrndate, 126) AS callsdtrndate,
      tc.vcomplaint,
      mstitems.vname AS itemname,
      calltype_fs.vdisplayvalue AS calltype,
      tc.callStatus AS Status,
      CASE
        WHEN tc.bsolved = 1 THEN 'Solved'
        WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 THEN 'Cancel'
        ELSE 'Open'
      END AS callstatus,
      tc.bsolved AS callsolved,
      CONVERT(varchar(30), tc.dsolvedatetime, 126) AS callsolveddate,
      tc.vsolveremarks,
      cr.vname AS cancel_reason
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY ${TRHCALLS_DEDUP_PARTITION}
          ORDER BY ${TRHCALLS_DEDUP_ORDER}
        ) AS rn
      FROM trhcalls (NOLOCK)
      WHERE ${where}
    ) tc
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
    WHERE tc.rn = 1
    ORDER BY tc.dtrndate DESC
  `;
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

/** All ncodes for the given display labels — one label can map to multiple ncode rows. */
export function buildCallTypeNcodeInSubquery(callType: string | null | undefined): string | null {
  if (!callType || callType === 'All' || callType === 'undefined' || callType === 'null') return null;

  const types = callType.split(',').map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) return null;

  const typeList = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
  return `(SELECT ncode FROM mstfixedselection (NOLOCK) WHERE vfieldname = 'ncalltype' AND vdisplayvalue IN (${typeList}))`;
}

export function appendCallTypeFilter(
  condition: string,
  callType: string | null | undefined,
  column = 'tc.ncalltype'
): string {
  const subquery = buildCallTypeNcodeInSubquery(callType);
  if (!subquery) return condition;
  return `${condition} AND ${column} IN ${subquery}`;
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
