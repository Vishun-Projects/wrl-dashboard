/**
 * Shared trhcalls query helpers — keep MIS Register and Call Distribution aligned.
 * Source table: trhcalls (deduplicated by vtrnno, latest row wins).
 */

import { parseRepairQueryParam } from '@/lib/serial-audit/repair-options';
import {
  REGISTER_ARCP_PICK_FIELDS_SQL,
  REGISTER_ARCP_PICK_OUTER_APPLY,
} from '@/lib/register/arcp-approve-dates';

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
  column?: TrhcallsDateColumn;
  fallbackDays?: number;
}): string {
  return buildTrhcallsDateRangePredicates({
    startDate: opts.startDate,
    endDate: opts.endDate,
    column: opts.column || 'dtrndate',
    fallbackDays: opts.fallbackDays,
  }).join(' AND ');
}

/** Truthy CRM bit flags stored as NVARCHAR. */
export function sqlTruthyCrmFlag(column: string): string {
  return `ISNULL(${column}, '0') IN ('1', 'True', 'true')`;
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
  'ncomplaint',
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
    (SELECT TOP 1 r.bmajor FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) AS is_major_repair,
    ${REGISTER_ARCP_PICK_FIELDS_SQL.trim()}
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
    ${REGISTER_ARCP_PICK_OUTER_APPLY}
  `;
}

/** Valid device serial on raw trhcalls row (no alias). */
export const SERIAL_AUDIT_VALID_SERIAL_WHERE =
  "ISNULL(vserialno, '') <> '' AND LTRIM(RTRIM(vserialno)) NOT IN ('0', 'N/A', 'NA', 'NONE', 'NULL', '-', '—')";

/** Exclude transferred calls on raw trhcalls row (no alias). */
export const SERIAL_AUDIT_TRANSFER_EXCLUDE_WHERE =
  "ISNULL(vtransfercallno, '') = '' AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2";

/** Canonical serial key for list grouping and detail filter (must stay in sync). */
export const SERIAL_AUDIT_SERIAL_KEY_EXPR = 'UPPER(LTRIM(RTRIM(vserialno)))';
export const SERIAL_AUDIT_TC_SERIAL_KEY_EXPR = 'UPPER(LTRIM(RTRIM(tc.vserialno)))';

export const TRHCALLS_CALL_ID_EXPR =
  "CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END";

const TRHCALLS_DEDUP_PARTITION =
  "CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END";

const TRHCALLS_DEDUP_ORDER = 'ISNULL(editedon, addedon) DESC, ncode DESC';

/** Max calendar days for a single client corpus download (wider ranges use server views per page). */
export const MAX_CLIENT_CORPUS_DAYS = 120;

export type SerialAuditSqlOpts = {
  callType?: string | null;
  /** Comma-separated mstrepair ncode values (visit fault repair). */
  repair?: string | null;
  /** Pre-expanded branch + franchisee office ids (from resolveSerialAuditSqlOpts). */
  branchOfficeIds?: string[];
  /** Pre-expanded assigned office scope for non-HOD users. */
  assignedOfficeIds?: string[];
  /** Comma-separated franchisee office ncode values. */
  franchisee?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
  startDate?: string | null;
  endDate?: string | null;
};

/** Fast office filter — use expanded ids from mstoffice (no correlated subquery). */
export function buildSerialAuditOfficeInFilterSql(
  officeIds: string[] | null | undefined,
  tableAlias = 'trhcalls'
): string {
  if (!officeIds?.length) return '';
  const list = officeIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
  return ` AND ${tableAlias}.nofficeid IN (${list})`;
}

function buildSerialAuditRepairNcodeInList(
  repair: string | null | undefined
): string | null {
  const ncodes = parseRepairQueryParam(repair);
  if (!ncodes.length) return null;
  return ncodes.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
}

function prefixSerialAuditWhereForAlias(where: string, alias: string): string {
  return where
    .replace(/\bvserialno\b/g, `${alias}.vserialno`)
    .replace(/\bvtrnno\b/g, `${alias}.vtrnno`)
    .replace(/\bvtransfercallno\b/g, `${alias}.vtransfercallno`)
    .replace(/\bncancelreason\b/g, `${alias}.ncancelreason`)
    .replace(/\bdtrndate\b/g, `${alias}.dtrndate`)
    .replace(/\bncalltype\b/g, `${alias}.ncalltype`)
    .replace(/\bnofficeid\b/g, `${alias}.nofficeid`)
    .replace(/trhcalls\.ncode/g, `${alias}.ncode`)
    .replace(/trhcalls\.nofficeid/g, `${alias}.nofficeid`);
}

function buildSerialAuditRepairWhereClauseForAlias(
  repair: string | null | undefined,
  alias: string
): string | null {
  const ncodeIn = buildSerialAuditRepairNcodeInList(repair);
  if (!ncodeIn) return null;
  return `EXISTS (
    SELECT 1 FROM trdcalls2fault tf (NOLOCK)
    INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
    WHERE tf.ncalls = ${alias}.ncode
      AND tf.nofficeid = ${alias}.nofficeid
      AND CAST(r.ncode AS VARCHAR(50)) IN (${ncodeIn})
  )`;
}

function buildSerialAuditBaseWhere(opts?: SerialAuditSqlOpts, tableAlias = 'trhcalls'): string {
  const alias = tableAlias;
  let where = prefixSerialAuditWhereForAlias(
    `${SERIAL_AUDIT_VALID_SERIAL_WHERE} AND vtrnno IS NOT NULL AND vtrnno <> '' AND ${SERIAL_AUDIT_TRANSFER_EXCLUDE_WHERE}`,
    alias
  );
  if (opts?.startDate) {
    where += ` AND ${alias}.dtrndate >= '${opts.startDate.replace(/'/g, "''")}'`;
  }
  if (opts?.endDate) {
    where += ` AND ${alias}.dtrndate <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`;
  }
  if (opts?.branchOfficeIds?.length) {
    where += buildSerialAuditOfficeInFilterSql(opts.branchOfficeIds, alias);
  } else if (!opts?.isHod && opts?.assignedOfficeIds?.length) {
    where += buildSerialAuditOfficeInFilterSql(opts.assignedOfficeIds, alias);
  }
  const callTypeSubquery = buildCallTypeNcodeInSubquery(opts?.callType);
  if (callTypeSubquery) {
    where += ` AND ${alias}.ncalltype IN ${callTypeSubquery}`;
  }
  const repairWhere = buildSerialAuditRepairWhereClauseForAlias(opts?.repair, alias);
  if (repairWhere) {
    where += ` AND ${repairWhere}`;
  }
  if (opts?.franchisee) {
    where += buildFranchiseeFilterSqlCondition(opts.franchisee, alias);
  }
  return where;
}

/** Visit-level repair counts per serial (motor / compressor / gas charging). */
function buildSerialAuditRepairBySerialSelect(): string {
  return `
    SUM(CASE WHEN LTRIM(RTRIM(r.vname)) = 'Motor Replaced' THEN 1 ELSE 0 END) AS motor_replaced_count,
    SUM(CASE WHEN LTRIM(RTRIM(r.vname)) = 'Compressor Replaced' THEN 1 ELSE 0 END) AS compressor_replaced_count,
    SUM(CASE WHEN LTRIM(RTRIM(r.vname)) = 'Gas Charging Done' THEN 1 ELSE 0 END) AS gas_charging_count`;
}

export function buildSerialAuditRepairCountsBySerialSql(opts?: SerialAuditSqlOpts): string {
  const tcWhere = buildSerialAuditBaseWhere({ ...opts, repair: null }, 'tc');
  return `
    SELECT
      ${SERIAL_AUDIT_TC_SERIAL_KEY_EXPR} AS serial,
      ${buildSerialAuditRepairBySerialSelect()}
    FROM trdcalls2fault tf (NOLOCK)
    INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
    INNER JOIN trhcalls tc (NOLOCK) ON tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
    WHERE ${tcWhere}
      AND LTRIM(RTRIM(r.vname)) IN ('Motor Replaced', 'Compressor Replaced', 'Gas Charging Done')
    GROUP BY ${SERIAL_AUDIT_TC_SERIAL_KEY_EXPR}
  `;
}

/** Active repair types from mstrepair (visit work done). */
export function buildMstRepairMasterListSql(): string {
  return `
    SELECT
      CAST(ncode AS VARCHAR(50)) AS ncode,
      LTRIM(RTRIM(vname)) AS vname
    FROM mstrepair (NOLOCK)
    WHERE LTRIM(RTRIM(ISNULL(vname, ''))) <> ''
      AND ISNULL(bactive, 'True') IN ('True', 'true', '1', '')
  `;
}

/** Call ncodes that have selected repairs on a visit fault row in the date window. */
export function buildSerialAuditCallIdsWithRepairSql(opts: {
  repair: string;
  startDate?: string | null;
  endDate?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
}): string {
  const ncodeIn = buildSerialAuditRepairNcodeInList(opts.repair);
  let where = `${SERIAL_AUDIT_VALID_SERIAL_WHERE} AND vtrnno IS NOT NULL AND vtrnno <> '' AND ${SERIAL_AUDIT_TRANSFER_EXCLUDE_WHERE}`;
  if (opts.startDate) {
    where += ` AND tc.dtrndate >= '${opts.startDate.replace(/'/g, "''")}'`;
  }
  if (opts.endDate) {
    where += ` AND tc.dtrndate <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`;
  }
  if (!opts.isHod && opts.assignedOffices && opts.assignedOffices.length > 0) {
    const allowed = opts.assignedOffices.join(',');
    where += ` AND (tc.nofficeid IN (${allowed}) OR tc.nofficeid IN (SELECT ncode FROM mstoffice (NOLOCK) WHERE nunder IN (${allowed})))`;
  }
  return `
    SELECT DISTINCT CAST(tf.ncalls AS VARCHAR(50)) AS call_ncode
    FROM trdcalls2fault tf (NOLOCK)
    INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
    INNER JOIN trhcalls tc (NOLOCK) ON tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
    WHERE ${where}
      AND CAST(r.ncode AS VARCHAR(50)) IN (${ncodeIn})
  `;
}

const SERIAL_AUDIT_REPAIR_DONE_EXPR = `(
  SELECT STUFF((
    SELECT DISTINCT '; ' + LTRIM(RTRIM(r.vname))
    FROM trdcalls2fault tf (NOLOCK)
    INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
    WHERE tf.ncalls = tc.ncode
      AND tf.nofficeid = tc.nofficeid
      AND LTRIM(RTRIM(ISNULL(r.vname, ''))) <> ''
    FOR XML PATH(''), TYPE
  ).value('.', 'NVARCHAR(MAX)'), 1, 2, '')
)`;

const SERIAL_AUDIT_MOTOR_REPAIR_EXISTS = `EXISTS (
  SELECT 1 FROM trdcalls2fault tf (NOLOCK)
  INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
  WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
    AND LTRIM(RTRIM(r.vname)) = 'Motor Replaced'
)`;
const SERIAL_AUDIT_COMPRESSOR_REPAIR_EXISTS = `EXISTS (
  SELECT 1 FROM trdcalls2fault tf (NOLOCK)
  INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
  WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
    AND LTRIM(RTRIM(r.vname)) = 'Compressor Replaced'
)`;
const SERIAL_AUDIT_GAS_REPAIR_EXISTS = `EXISTS (
  SELECT 1 FROM trdcalls2fault tf (NOLOCK)
  INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
  WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
    AND LTRIM(RTRIM(r.vname)) = 'Gas Charging Done'
)`;

/** Motor / compressor / gas only — for ASP involvement batch (avoids FOR XML repair list). */
const SERIAL_AUDIT_INVOLVEMENT_REPAIR_DONE_EXPR = `LTRIM(
  CASE WHEN ${SERIAL_AUDIT_MOTOR_REPAIR_EXISTS} THEN 'Motor Replaced' ELSE '' END
  + CASE WHEN ${SERIAL_AUDIT_COMPRESSOR_REPAIR_EXISTS} THEN '; Compressor Replaced' ELSE '' END
  + CASE WHEN ${SERIAL_AUDIT_GAS_REPAIR_EXISTS} THEN '; Gas Charging Done' ELSE '' END
)`;

/** Repeated serials in a date window — deduped rows with status counts.
 *  Nested subqueries only (db-proxy wraps as SELECT * FROM (...) t — CTE/WITH is invalid). */
export function buildSerialAuditWindowListRawSql(
  opts: SerialAuditSqlOpts & { minRepeats?: number }
): string {
  const minRepeats = Math.max(2, opts.minRepeats ?? 2);
  const where = buildSerialAuditBaseWhere(opts);

  const tcWhere = buildSerialAuditBaseWhere({ ...opts, repair: null }, 'tc');

  return `
    SELECT
      a.serial,
      a.complaint_count,
      a.open_count,
      a.solved_count,
      a.cancelled_count,
      a.last_complaint_date,
      ISNULL(r.motor_replaced_count, 0) AS motor_replaced_count,
      ISNULL(r.compressor_replaced_count, 0) AS compressor_replaced_count,
      ISNULL(r.gas_charging_count, 0) AS gas_charging_count
    FROM (
      SELECT
        ${SERIAL_AUDIT_SERIAL_KEY_EXPR} AS serial,
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
      GROUP BY ${SERIAL_AUDIT_SERIAL_KEY_EXPR}
      HAVING COUNT(*) >= ${minRepeats}
    ) a
    LEFT JOIN (
      SELECT
        ${SERIAL_AUDIT_TC_SERIAL_KEY_EXPR} AS serial,
        ${buildSerialAuditRepairBySerialSelect()}
      FROM trdcalls2fault tf (NOLOCK)
      INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
      INNER JOIN trhcalls tc (NOLOCK) ON tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
      WHERE ${tcWhere}
        AND LTRIM(RTRIM(r.vname)) IN ('Motor Replaced', 'Compressor Replaced', 'Gas Charging Done')
      GROUP BY ${SERIAL_AUDIT_TC_SERIAL_KEY_EXPR}
    ) r ON r.serial = a.serial
  `;
}

/** Repeated serials in the applied date window (startDate and endDate required). */
export function buildSerialAuditListRawSql(
  opts: SerialAuditSqlOpts & { minRepeats?: number }
): string {
  return buildSerialAuditWindowListRawSql(opts);
}

/** All calls for one serial — scoped dedup + minimal joins. */
function buildSerialAuditDetailQuery(where: string, involvementRepairs = false): string {
  const repairDoneExpr = involvementRepairs
    ? SERIAL_AUDIT_INVOLVEMENT_REPAIR_DONE_EXPR
    : SERIAL_AUDIT_REPAIR_DONE_EXPR;
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
      ${repairDoneExpr} AS repair_done,
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

export function buildSerialAuditDetailRawSql(serial: string, opts: SerialAuditSqlOpts): string {
  const serialSafe = serial.trim().replace(/'/g, "''").toUpperCase();
  const where = `${buildSerialAuditBaseWhere(opts)} AND ${SERIAL_AUDIT_SERIAL_KEY_EXPR} = '${serialSafe}'`;
  return buildSerialAuditDetailQuery(where);
}

const MAX_SERIAL_AUDIT_BATCH_SERIALS = 80;
/** Smaller IN lists for involvement batch queries (reduces SQL Server timeouts). */
const MAX_SERIAL_AUDIT_INVOLVEMENT_BATCH_SERIALS = 20;

export { MAX_SERIAL_AUDIT_BATCH_SERIALS, MAX_SERIAL_AUDIT_INVOLVEMENT_BATCH_SERIALS };

/** Window calls for multiple flagged serials — one query. */
export function buildSerialAuditBatchDetailRawSql(
  serials: string[],
  opts: SerialAuditSqlOpts,
  involvementRepairs = false
): string {
  const batchLimit = involvementRepairs
    ? MAX_SERIAL_AUDIT_INVOLVEMENT_BATCH_SERIALS
    : MAX_SERIAL_AUDIT_BATCH_SERIALS;
  const safeSerials = serials
    .map((s) => s.trim().replace(/'/g, "''").toUpperCase())
    .filter(Boolean)
    .slice(0, batchLimit);
  if (safeSerials.length === 0) {
    return `SELECT TOP 0 tc.ncode AS id FROM trhcalls tc (NOLOCK) WHERE 1 = 0`;
  }
  const inList = safeSerials.map((s) => `'${s}'`).join(',');
  const where = `${buildSerialAuditBaseWhere(opts)} AND ${SERIAL_AUDIT_SERIAL_KEY_EXPR} IN (${inList})`;
  return buildSerialAuditDetailQuery(where, involvementRepairs);
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

/** Full-table dedup subquery scoped to a TRN/reference lookup (optional date window). */
export function buildTrhcallsLookupSubquery(
  search: string,
  opts?: {
    startDate?: string;
    endDate?: string;
    dateFilterColumn?: RegisterDateFilterColumn;
  }
): string {
  let lookupWhere = buildIdentifierLookupWhere(search, false);
  const dateCol = resolveRegisterDateSqlColumn(opts?.dateFilterColumn);
  if (opts?.startDate) {
    lookupWhere += ` AND ${dateCol} >= '${opts.startDate.replace(/'/g, "''")}'`;
  }
  if (opts?.endDate) {
    lookupWhere += ` AND ${dateCol} <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`;
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

/** Raw trhcalls column names used in date-range WHERE (no alias). */
export type TrhcallsDateColumn = RegisterDateFilterColumn | 'editedon';

export const REGISTER_DATE_FILTER_OPTIONS: { value: RegisterDateFilterColumn; label: string }[] = [
  { value: 'dtrndate', label: 'Call Date' },
  { value: 'dsolvedatetime', label: 'Solved Date' },
];

export function resolveRegisterDateSqlColumn(column: string | null | undefined): RegisterDateFilterColumn {
  return column === 'dsolvedatetime' ? 'dsolvedatetime' : 'dtrndate';
}

/** CRM NVARCHAR date comparisons — `column` may be qualified (e.g. `tc.dtrndate`). */
export function buildTrhcallsDateRangePredicates(opts: {
  startDate?: string | null;
  endDate?: string | null;
  column: TrhcallsDateColumn | string;
  fallbackDays?: number;
}): string[] {
  const col = opts.column;
  const parts: string[] = [];
  if (opts.startDate) {
    parts.push(`${col} >= '${opts.startDate.replace(/'/g, "''")}'`);
  } else if (opts.fallbackDays != null) {
    parts.push(`${col} >= DATEADD(day, -${opts.fallbackDays}, GETDATE())`);
  }
  if (opts.endDate) {
    parts.push(`${col} <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`);
  }
  return parts;
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

import { appendOfficeSecurityFilter } from '@/lib/trhcalls/office-security';

export { appendOfficeSecurityFilter } from '@/lib/trhcalls/office-security';

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
