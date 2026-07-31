import 'server-only';

import {
  appendCallTypeFilter,
  appendOfficeSecurityFilter,
  buildFranchiseeFilterSqlCondition,
  buildTrhcallsDedupSubquery,
  sqlFranchiseeCodeExpr,
  sqlFranchiseeNameExpr,
} from '@/sql/trhcalls/query';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/modules/mis';

export {
  LOCATION_AUDIT_MAX_ROWS,
  LOCATION_AUDIT_LIST_PAGE_SIZE,
  filterLocationAuditListRows,
  type LocationAuditStatus,
  type LocationAuditFraudSignal,
  type LocationAuditSeverity,
  type LocationAuditListRow,
  type LocationAuditDetailRow,
  type LocationAuditRow,
  type LocationAuditSummary,
  type LocationAuditByBranch,
  type LocationAuditQueryParams,
  type LocationAuditPhase,
  type LocationAuditSignals,
} from '@/modules/location-audit/services/types';

export {
  analyzeListTierFromRaw,
  analyzeListTierRows,
  enrichDetailTier,
  summarizeLocationAuditListRows,
  aggregateByBranch,
  analyzeFullExportRows,
  buildMismatchExplanation,
} from '@/modules/location-audit/server/analyze';

export { exportLocationAuditCsv } from '@/modules/location-audit/services/export-csv';

import {
  analyzeListTierRows,
  summarizeLocationAuditListRows,
} from '@/modules/location-audit/server/analyze';
import {
  filterLocationAuditListRows,
  LOCATION_AUDIT_MAX_ROWS,
  clampLocationAuditLimit,
  type LocationAuditListRow,
  type LocationAuditQueryParams,
} from '@/modules/location-audit/services/types';

const MAJOR_REPAIR_EXISTS = `
  EXISTS (
    SELECT 1 FROM trdcalls2fault tf (NOLOCK)
    JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
    WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True'
  )`;

const TECH_SOLVED_WHERE = `
  ISNULL(tc.bfastclose, 0) = 1
  AND ISNULL(tc.bsolved, 0) = 0
  AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)`;

const SELECT_FIELDS = `
      tc.vtrnno AS vtrnno,
      tc.vcclid AS vcclid,
      CAST(tc.ncode AS VARCHAR(50)) AS ncode,
      CAST(tc.nofficeid AS VARCHAR(50)) AS nofficeid,
      CONVERT(varchar(30), tc.dtrndate, 126) AS callsdtrndate,
      p.vname AS PartyName,
      p.vinstaddress AS vinstaddress,
      p.vinstpostalcode AS Pincode,
      cty.vname AS dbCity,
      st.vname AS dbState,
      p.vlatlong AS vlatlong,
      p.mlatlong AS mlatlong,
      o.vcompanyname AS office_name,
      bo.vcompanyname AS branch_office_name,
      ${sqlFranchiseeCodeExpr()} AS franchisee_code,
      ${sqlFranchiseeNameExpr()} AS franchisee_name,
      u.vname AS serviceman,
      calltype_fs.vdisplayvalue AS calltype`;

/** Column names projected by the inner select (for outer paginated query — no table aliases). */
const SELECT_OUTPUT_COLUMNS = `
      vtrnno,
      vcclid,
      ncode,
      nofficeid,
      callsdtrndate,
      PartyName,
      vinstaddress,
      Pincode,
      dbCity,
      dbState,
      vlatlong,
      mlatlong,
      office_name,
      branch_office_name,
      franchisee_code,
      franchisee_name,
      serviceman,
      calltype`;

const FROM_JOINS = `
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'`;

export function buildLocationAuditWhereClause(opts: LocationAuditQueryParams): string {
  const callType =
    opts.callType && opts.callType !== 'All' ? opts.callType : SUMMARY_DEFAULT_CALL_TYPE;
  const dateColumn = opts.dateColumn ?? 'dtrndate';

  let condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')
    AND ISNULL(tc.vtransfercallno, '') = ''
    AND ISNULL(CAST(tc.ncancelreason AS INT), 0) <> 2
    AND ${MAJOR_REPAIR_EXISTS}
    AND ${TECH_SOLVED_WHERE}`;
  condition = appendCallTypeFilter(condition, callType);
  condition = appendOfficeSecurityFilter(condition, opts.isHod, opts.assignedOffices);

  if (opts.startDate) {
    condition += ` AND tc.${dateColumn} >= '${opts.startDate.replace(/'/g, "''")}'`;
  }
  if (opts.endDate) {
    condition += ` AND tc.${dateColumn} <= '${opts.endDate.replace(/'/g, "''")} 23:59:59'`;
  }

  if (opts.officeId && opts.officeId !== 'All' && opts.officeId !== 'undefined') {
    if (opts.officeId.includes(',')) {
      condition += ` AND tc.nofficeid IN (${opts.officeId})`;
    } else {
      condition += ` AND tc.nofficeid = ${opts.officeId.replace(/'/g, "''")}`;
    }
  }

  if (opts.franchisee && opts.franchisee !== 'All') {
    condition += buildFranchiseeFilterSqlCondition(opts.franchisee);
  }

  if (opts.branch && opts.branch !== 'All') {
    const branches = opts.branch.split(',').map((b) => b.trim()).filter(Boolean);
    if (branches.length === 1) {
      const safe = branches[0].replace(/'/g, "''");
      condition += ` AND (tc.nofficeid = '${safe}' OR o.nunder = '${safe}')`;
    } else if (branches.length > 1) {
      const list = branches.map((b) => `'${b.replace(/'/g, "''")}'`).join(',');
      condition += ` AND (tc.nofficeid IN (${list}) OR o.nunder IN (${list}))`;
    }
  }

  if (opts.technician && opts.technician !== 'All') {
    const techs = opts.technician.split(',').map((t) => t.trim()).filter(Boolean);
    if (techs.length === 1) {
      condition += ` AND tc.nengineer = '${techs[0].replace(/'/g, "''")}'`;
    } else if (techs.length > 1) {
      condition += ` AND tc.nengineer IN (${techs.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`;
    }
  }

  if (opts.pincode) {
    const safe = opts.pincode.replace(/'/g, "''");
    condition += ` AND p.vinstpostalcode LIKE '%${safe}%'`;
  }

  if (opts.state && opts.state !== 'All') {
    const states = opts.state.split(',').map((s) => s.trim()).filter(Boolean);
    if (states.length > 0) {
      const list = states.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
      condition += ` AND st.vname IN (${list})`;
    }
  }

  if (opts.city && opts.city !== 'All') {
    const cities = opts.city.split(',').map((c) => c.trim()).filter(Boolean);
    if (cities.length > 0) {
      const list = cities.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
      condition += ` AND cty.vname IN (${list})`;
    }
  }

  return condition;
}

function buildDedupFrom(opts: LocationAuditQueryParams): string {
  return buildTrhcallsDedupSubquery({
    startDate: opts.startDate,
    endDate: opts.endDate,
    fallbackDays: null,
    column: opts.dateColumn ?? 'dtrndate',
  });
}

/** Summary / export cap — up to LOCATION_AUDIT_MAX_ROWS. */
export function buildLocationAuditRawSql(opts: LocationAuditQueryParams): string {
  const limit = clampLocationAuditLimit(opts.limit);
  const condition = buildLocationAuditWhereClause(opts);
  const dedup = buildDedupFrom(opts);

  return `
    SELECT TOP ${limit}
      ${SELECT_FIELDS}
    FROM ${dedup}
    ${FROM_JOINS}
    WHERE ${condition}
    ORDER BY tc.dtrndate DESC, tc.ncode DESC
  `;
}

/** Server-side paginated list fetch (ROW_NUMBER — CRM postQuery injects TOP 100 PERCENT, which forbids OFFSET/FETCH). */
export function buildLocationAuditPaginatedSql(opts: LocationAuditQueryParams): string {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? 50), 100);
  const offset = (page - 1) * pageSize;
  const rowEnd = offset + pageSize;
  const condition = buildLocationAuditWhereClause(opts);
  const dedup = buildDedupFrom(opts);

  return `
    SELECT TOP 100 PERCENT
      ${SELECT_OUTPUT_COLUMNS}
    FROM (
      SELECT
        ${SELECT_FIELDS},
        ROW_NUMBER() OVER (ORDER BY tc.dtrndate DESC, tc.ncode DESC) AS __page_rn
      FROM ${dedup}
      ${FROM_JOINS}
      WHERE ${condition}
    ) AS __paged
    WHERE __paged.__page_rn > ${offset} AND __paged.__page_rn <= ${rowEnd}
  `;
}

/** Single call for detail tier. */
export function buildLocationAuditRowSql(
  ncode: string,
  officeId: string,
  security: Pick<LocationAuditQueryParams, 'isHod' | 'assignedOffices'>
): string {
  const safeNcode = ncode.replace(/'/g, "''");
  const safeOffice = officeId.replace(/'/g, "''");
  let condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')
    AND CAST(tc.ncode AS VARCHAR(50)) = '${safeNcode}'
    AND CAST(tc.nofficeid AS VARCHAR(50)) = '${safeOffice}'
    AND ${TECH_SOLVED_WHERE}`;
  condition = appendOfficeSecurityFilter(condition, security.isHod, security.assignedOffices);

  return `
    SELECT TOP 1
      ${SELECT_FIELDS}
    FROM trhcalls tc (NOLOCK)
    ${FROM_JOINS}
    WHERE ${condition}
  `;
}

export function buildLocationAuditVisitSql(ncode: string, officeId: string): string {
  const safeNcode = ncode.replace(/'/g, "''");
  const safeOffice = officeId.replace(/'/g, "''");
  return `
    SELECT TOP 1
      v.vstartlatlong AS vstartlatlong,
      v.vendlatlong AS vendlatlong,
      v.mlatlong AS mlatlong,
      CONVERT(varchar(30), v.dvisitdatetime, 126) AS dvisitdatetime,
      ISNULL(v.bremotesupport, 0) AS bremotesupport
    FROM trdcalls1visit v (NOLOCK)
    WHERE v.ncalls = '${safeNcode}' AND v.nofficeid = '${safeOffice}'
    ORDER BY v.dvisitdatetime DESC
  `;
}

/** @deprecated Use analyzeListTierRows */
export function analyzeLocationAuditRows(rawRows: Record<string, unknown>[]) {
  return { rows: analyzeListTierRows(rawRows) };
}

/** @deprecated Use filterLocationAuditListRows */
export function filterLocationAuditRows(
  rows: LocationAuditListRow[],
  opts: { mismatchesOnly: boolean }
) {
  return filterLocationAuditListRows(rows, opts);
}

/** @deprecated Use summarizeLocationAuditListRows */
export function summarizeLocationAuditRows(rows: LocationAuditListRow[]) {
  return summarizeLocationAuditListRows(rows, LOCATION_AUDIT_MAX_ROWS);
}
