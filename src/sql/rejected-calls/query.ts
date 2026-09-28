import {
  appendCallTypeFilter,
  buildRepairNcodeExistsWhere,
  TRHCALLS_PARENT_OFFICE_EXCLUDE,
} from '@/sql/trhcalls/query';
import { appendOfficeSecurityFilter } from '@/sql/trhcalls/office-security';
import {
  BLANK_REASON_KEY,
  reasonGroupTokens,
  reasonTokenNeedles,
} from '@/sql/rejected-calls/reason-groups';

export type RejectedBySource = 'HO' | 'Branch';

export type RejectedCallsSqlOpts = {
  startDate: string;
  endDate: string;
  source: RejectedBySource | null;
  isHod: boolean;
  assignedOffices: string[];
  callType?: string | null;
  officeId?: string | null;
  technician?: string | null;
  search?: string | null;
  reasons?: string[];
  repair?: string | null;
  dateFilterColumn?: string | null;
  omitCallType?: boolean;
  omitReason?: boolean;
  offset?: number;
  limit?: number;
};

/** Currently rejected: HO flag set and not un-rejected, or BM flag set. */
export const HO_REJECT_SQL =
  '(ISNULL(tc.bhoreject, 0) = 1 AND ISNULL(tc.bhounreject, 0) = 0)';
export const BM_REJECT_SQL = 'ISNULL(tc.bBMreject, 0) = 1';

export const REJECTED_WHERE_SQL = `(${HO_REJECT_SQL} OR ${BM_REJECT_SQL})`;

export const REJECT_AT_SQL = `COALESCE(
  CASE
    WHEN ${HO_REJECT_SQL} THEN tc.dhorejectdatetime
    WHEN ${BM_REJECT_SQL} THEN tc.dBMrejectdatetime
  END,
  tc.dtrndate
)`;

export const REJECTED_BY_SOURCE_SQL = `CASE
  WHEN ${HO_REJECT_SQL} THEN 'HO'
  ELSE 'Branch'
END`;

export const REJECTION_REASON_SQL = `CASE
  WHEN ${HO_REJECT_SQL} THEN tc.vhorejectreason
  ELSE tc.vBMrejectreason
END`;

export const REJECTED_BY_NAME_SQL = `CASE
  WHEN ${HO_REJECT_SQL} THEN ho_u.vname
  ELSE bm_u.vname
END`;

const CALL_NO_SQL = `COALESCE(
  NULLIF(LTRIM(RTRIM(tc.vtrnno)), ''),
  NULLIF(LTRIM(RTRIM(tc.vtransfercallno)), ''),
  CAST(tc.ncode AS VARCHAR(50))
)`;

const BRANCH_NAME_SQL = `ISNULL(NULLIF(LTRIM(RTRIM(bo.vcompanyname)), ''), o.vcompanyname)`;

const FRANCHISEE_NAME_SQL = `CASE
  WHEN o.nunder NOT IN (${TRHCALLS_PARENT_OFFICE_EXCLUDE.join(', ')})
    AND o.nunder IS NOT NULL AND o.nunder <> 0
  THEN o.vcompanyname
  ELSE 'Unallocated'
END`;

const CALL_TYPE_LABEL_SQL = `ISNULL(NULLIF(LTRIM(RTRIM(calltype_fs.vdisplayvalue)), ''), '(blank)')`;
const REASON_LABEL_SQL = `ISNULL(NULLIF(LTRIM(RTRIM(${REJECTION_REASON_SQL})), ''), '(blank)')`;
const REPAIR_DONE_SQL = `ISNULL(NULLIF((
  SELECT STUFF((
    SELECT DISTINCT '; ' + LTRIM(RTRIM(r.vname))
    FROM trdcalls2fault tf (NOLOCK)
    INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
    WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
      AND LTRIM(RTRIM(ISNULL(r.vname, ''))) <> ''
    FOR XML PATH(''), TYPE
  ).value('.', 'NVARCHAR(MAX)'), 1, 2, '')
), ''), tc.vsolveremarks)`;

function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}

function likeEscape(value: string): string {
  return sqlQuote(value).replace(/\[/g, '[[]').replace(/%/g, '[%]').replace(/_/g, '[_]');
}

function idList(raw: string | null | undefined): string[] {
  if (!raw || raw === 'All') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

function rejectedSourceWhere(source: RejectedBySource | null): string {
  if (source === 'HO') return HO_REJECT_SQL;
  if (source === 'Branch') {
    return `(${BM_REJECT_SQL} AND NOT ${HO_REJECT_SQL})`;
  }
  return REJECTED_WHERE_SQL;
}

export function rejectedDateColumnSql(dateFilterColumn?: string | null): string {
  if (dateFilterColumn === 'dsolvedatetime') return 'tc.dsolvedatetime';
  if (dateFilterColumn === 'dtrndate') return 'tc.dtrndate';
  return REJECT_AT_SQL;
}

function officeScopeSql(officeId: string | null | undefined): string {
  const ids = idList(officeId);
  if (ids.length === 1) {
    return ` AND (tc.nofficeid = ${ids[0]} OR o.nunder = ${ids[0]})`;
  }
  if (ids.length > 1) {
    const list = ids.join(',');
    return ` AND (tc.nofficeid IN (${list}) OR o.nunder IN (${list}))`;
  }
  return '';
}

function likeContainsWord(expr: string, needle: string): string {
  const n = likeEscape(needle.toUpperCase());
  if (n.length >= 4) return `UPPER(${expr}) LIKE '%${n}%'`;
  return `(
    UPPER(${expr}) LIKE '%[^A-Z0-9]${n}[^A-Z0-9]%'
    OR UPPER(${expr}) LIKE '${n}[^A-Z0-9]%'
    OR UPPER(${expr}) LIKE '%[^A-Z0-9]${n}'
    OR UPPER(${expr}) = '${n}'
  )`;
}

function reasonGroupPredicate(key: string): string {
  if (key === BLANK_REASON_KEY) {
    return `NULLIF(LTRIM(RTRIM(${REJECTION_REASON_SQL})), '') IS NULL`;
  }
  const tokens = reasonGroupTokens(key);
  if (tokens.length === 0) return '1=0';
  const ands = tokens.map((token) => {
    const needles = reasonTokenNeedles(token);
    const ors = needles.map((n) => likeContainsWord(REJECTION_REASON_SQL, n));
    return ors.length === 1 ? ors[0] : `(${ors.join(' OR ')})`;
  });
  return ands.length === 1 ? ands[0] : `(${ands.join(' AND ')})`;
}

function reasonScopeSql(reasons: string[] | undefined, omitReason?: boolean): string {
  if (omitReason || !reasons?.length) return '';
  const parts = [...new Set(reasons.filter(Boolean))].map(reasonGroupPredicate);
  if (parts.length === 0) return '';
  return ` AND (${parts.join(' OR ')})`;
}

export function buildRejectedCallsWhereSql(opts: RejectedCallsSqlOpts): string {
  const dateSql = rejectedDateColumnSql(opts.dateFilterColumn);
  let condition = rejectedSourceWhere(opts.source);
  condition += ` AND ${dateSql} >= '${sqlQuote(opts.startDate)}'`;
  condition += ` AND ${dateSql} <= '${sqlQuote(opts.endDate)} 23:59:59'`;
  if (!opts.omitCallType) {
    condition = appendCallTypeFilter(condition, opts.callType);
  }
  condition += officeScopeSql(opts.officeId);
  condition += reasonScopeSql(opts.reasons, opts.omitReason);
  const repairExists = buildRepairNcodeExistsWhere(opts.repair, 'tc');
  if (repairExists) condition += ` AND ${repairExists}`;
  const techs = idList(opts.technician);
  if (techs.length === 1) {
    condition += ` AND tc.nengineer = ${techs[0]}`;
  } else if (techs.length > 1) {
    condition += ` AND tc.nengineer IN (${techs.join(',')})`;
  }
  const search = opts.search?.trim();
  if (search) {
    const like = `'%${likeEscape(search)}%'`;
    condition += ` AND (
      ${CALL_NO_SQL} LIKE ${like}
      OR ISNULL(tc.vserialno, '') LIKE ${like}
      OR ISNULL(tc.vhorejectreason, '') LIKE ${like}
      OR ISNULL(tc.vBMrejectreason, '') LIKE ${like}
      OR ISNULL(tc.vsolveremarks, '') LIKE ${like}
    )`;
  }
  return appendOfficeSecurityFilter(condition, opts.isHod, opts.assignedOffices);
}

const FROM_LEAN = `
    FROM trhcalls tc (NOLOCK)
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK)
      ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'`;

const FROM_LIST = `
    ${FROM_LEAN}
    LEFT JOIN mstusers ho_u (NOLOCK) ON tc.nhorejectby = ho_u.ncode
    LEFT JOIN mstusers bm_u (NOLOCK) ON tc.nBMrejectby = bm_u.ncode`;

export function buildRejectedCallsSummarySql(opts: RejectedCallsSqlOpts): string {
  const where = buildRejectedCallsWhereSql({ ...opts, omitCallType: true, omitReason: true });
  return `
    SELECT 'call_type' AS kind, ${CALL_TYPE_LABEL_SQL} AS label, COUNT(*) AS total
    ${FROM_LEAN}
    WHERE ${where}
    GROUP BY ${CALL_TYPE_LABEL_SQL}
    UNION ALL
    SELECT 'reason' AS kind, ${REASON_LABEL_SQL} AS label, COUNT(*) AS total
    ${FROM_LEAN}
    WHERE ${where}
    GROUP BY ${REASON_LABEL_SQL}
  `;
}

export function buildRejectedCallsListSql(opts: RejectedCallsSqlOpts): string {
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(1, opts.limit ?? 50);
  const dateOrder = rejectedDateColumnSql(opts.dateFilterColumn);
  return `
    SELECT
      tc.ncode AS ncode,
      tc.nofficeid AS nofficeid,
      ${CALL_NO_SQL} AS call_no,
      CONVERT(varchar(30), tc.dtrndate, 126) AS call_date,
      tc.vserialno AS serial_no,
      calltype_fs.vdisplayvalue AS call_type,
      ${REPAIR_DONE_SQL} AS activity_done,
      CONVERT(varchar(30), tc.dsolvedatetime, 126) AS solve_date,
      ${REJECTED_BY_SOURCE_SQL} AS rejected_by_source,
      CONVERT(varchar(30), ${REJECT_AT_SQL}, 126) AS rejection_at,
      ${REJECTION_REASON_SQL} AS rejection_reason,
      ${REJECTED_BY_NAME_SQL} AS rejected_by_name,
      ${BRANCH_NAME_SQL} AS branch_name,
      ${FRANCHISEE_NAME_SQL} AS franchisee_name,
      COUNT(*) OVER() AS total
    ${FROM_LIST}
    WHERE ${buildRejectedCallsWhereSql(opts)}
    ORDER BY ${dateOrder} DESC, tc.ncode DESC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;
}
