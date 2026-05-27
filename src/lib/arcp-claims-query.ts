import {
  appendCallTypeFilter,
} from '@/lib/trhcalls-query';

export type ArcpDateFilterColumn = 'dcalllogdatetime' | 'dsolveddatetime' | 'approve';

export const ARCP_DATE_FILTER_OPTIONS: { value: ArcpDateFilterColumn; label: string }[] = [
  { value: 'dcalllogdatetime', label: 'Call Date' },
  { value: 'dsolveddatetime', label: 'Call Solve Date' },
  { value: 'approve', label: 'Call Approve Date' },
];

/** Up to ~2 months completes in one CRM query (~4–5s). Wider spans split automatically. */
export const ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS = 62;
/** Approve-date uses three date columns — keep windows small to stay under CRM 30s timeout. */
export const ARCP_APPROVE_CHUNK_DAYS = 7;
/** @deprecated use ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS */
export const ARCP_QUERY_CHUNK_DAYS = ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS;

export type ArcpClaimsQueryOpts = {
  startDate?: string | null;
  endDate?: string | null;
  dateFilterColumn?: string | null;
  branch?: string | null;
  franchisee?: string | null;
  callType?: string | null;
  isHod?: boolean;
  assignedOffices?: string[];
};

export type ArcpClaimsAggregateRow = {
  claim_month: string;
  ncalltype: string;
  call_type_label: string;
  nitemcategory: string;
  item_category_label: string;
  nlocalupcountry: string;
  local_upcountry_label: string;
  is_travel: number | string;
  major_minor: string;
  rate: number | string | null;
  qty: number | string;
  amount_payable: number | string | null;
  branch_approved: number | string | null;
  ho_approved: number | string | null;
};

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export function resolveArcpDateFilterColumn(column: string | null | undefined): ArcpDateFilterColumn {
  if (column === 'dsolveddatetime' || column === 'approve') return column;
  return 'dcalllogdatetime';
}

function appendCsvInFilter(condition: string, column: string, param: string | null | undefined): string {
  if (!param || param === 'All' || param === 'undefined' || param === 'null') return condition;
  const values = param
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return condition;
  const list = values.map((v) => `'${escapeSql(v)}'`).join(',');
  return `${condition} AND ${column} IN (${list})`;
}

function appendArcpOfficeSecurityFilter(
  condition: string,
  isHod: boolean,
  assignedOffices: string[]
): string {
  if (isHod || assignedOffices.length === 0) return condition;
  const allowed = assignedOffices.map((o) => `'${escapeSql(o)}'`).join(',');
  return `${condition} AND (arcp.nofficeid IN (${allowed}) OR o.nunder IN (${allowed}))`;
}

function appendArcpDateFilter(
  condition: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  dateColumn: ArcpDateFilterColumn
): string {
  let next = condition;
  const endSuffix = endDate ? ` 23:59:59` : '';

  if (dateColumn === 'approve') {
    if (startDate) {
      const start = escapeSql(startDate);
      next += ` AND ${ARCP_EFFECTIVE_APPROVE_DATE_EXPR} >= '${start}'`;
    }
    if (endDate) {
      const end = escapeSql(endDate);
      next += ` AND ${ARCP_EFFECTIVE_APPROVE_DATE_EXPR} <= '${end}${endSuffix}'`;
    }
    return next;
  }

  const col = dateColumn;
  if (startDate) {
    next += ` AND arcp.${col} >= '${escapeSql(startDate)}'`;
  }
  if (endDate) {
    next += ` AND arcp.${col} <= '${escapeSql(endDate)}${endSuffix}'`;
  }
  return next;
}

const MAJOR_MINOR_EXPR = `
  CASE WHEN major.ncalls IS NOT NULL THEN 'Major' ELSE 'Minor' END`;

const ARCP_NOT_REJECTED = `
  AND ISNULL(arcp.breject, '0') NOT IN ('1', 'True', 'true')
  AND ISNULL(arcp.brejectho, '0') NOT IN ('1', 'True', 'true')`;

/** NVARCHAR CRM columns may contain blanks or non-numeric text — never use CAST. */
const SAFE_FLOAT = (column: string) =>
  `TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(${column} AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT)`;

const BRANCH_APPROVED_VAL_EXPR = `
  COALESCE(
    ${SAFE_FLOAT('arcp.nbmapprovedamt')},
    ${SAFE_FLOAT('arcp.napproval1amount')}
  )`;

const HO_APPROVED_VAL_EXPR = `
  COALESCE(
    ${SAFE_FLOAT('arcp.nhoapprovedamt')},
    ${SAFE_FLOAT('arcp.napproval2amount')}
  )`;

/** Claim payable from franchisee ARCP line. */
const AMOUNT_PAYABLE_VAL_EXPR = `${SAFE_FLOAT('arcp.nchargespayable')}`;

/** Known CRM ncodes for local/upcountry when mstfixedselection join misses. */
export const LOCAL_UPCOUNTRY_NCODE_LABELS: Record<string, 'Local' | 'Upcountry'> = {
  '1': 'Local',
  '2': 'Upcountry',
  '946': 'Local',
  '947': 'Upcountry',
};

const LOCAL_UPCOUNTRY_CASE_SQL = Object.entries(LOCAL_UPCOUNTRY_NCODE_LABELS)
  .map(([code, label]) => `WHEN '${code}' THEN '${label}'`)
  .join('\n        ');

const ARCP_INCLUDED_LINES_FILTER = `
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (
      ISNULL(arcp.nitemcategory, '') <> ''
      AND arcp.nitemcategory <> '0'
      AND COALESCE(
        NULLIF(LTRIM(RTRIM(ic.vname)), ''),
        NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
      ) IS NOT NULL
    )
  )`;

/** CRM stores approve timestamps as dd/mm/yyyy text on dbm/dho approved date columns. */
const ARCP_HO_APPROVE_DT_EXPR = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dhoapproveddate AS VARCHAR(30)))), ''), 103)`;
const ARCP_BM_APPROVE_DT_EXPR = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''), 103)`;
const ARCP_EFFECTIVE_APPROVE_DATE_EXPR = `COALESCE(${ARCP_HO_APPROVE_DT_EXPR}, ${ARCP_BM_APPROVE_DT_EXPR})`;

function buildArcpClaimMonthExpr(dateColumn: ArcpDateFilterColumn): string {
  const parseDt = (column: string) =>
    `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.${column} AS VARCHAR(30)))), ''), 103)`;

  const dateExpr =
    dateColumn === 'approve'
      ? ARCP_EFFECTIVE_APPROVE_DATE_EXPR
      : dateColumn === 'dsolveddatetime'
        ? parseDt('dsolveddatetime')
        : parseDt('dcalllogdatetime');

  return `ISNULL(FORMAT(${dateExpr}, 'yyyy-MM'), 'unknown')`;
}

/** Index-friendly approve filter for a date window (one row belongs to one window). */
function buildArcpApproveDateJoin(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  if (!startDate || !endDate) return '';
  const start = escapeSql(startDate);
  const end = escapeSql(endDate);
  const endTs = `${end} 23:59:59`;
  return `
INNER JOIN (
  SELECT ncode FROM trdcalls10ARCP (NOLOCK)
  WHERE nofficetype = '3'
    AND COALESCE(
      TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dhoapproveddate AS VARCHAR(30)))), ''), 103),
      TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))), ''), 103)
    ) >= '${start}'
    AND COALESCE(
      TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dhoapproveddate AS VARCHAR(30)))), ''), 103),
      TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))), ''), 103)
    ) <= '${endTs}'
) arcp_dates ON arcp.ncode = arcp_dates.ncode`;
}

function buildArcpClaimsFilterParts(opts: ArcpClaimsQueryOpts): {
  condition: string;
  approveDateJoin: string;
} {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  let condition = "arcp.nofficetype = '3'";
  let approveDateJoin = '';

  if (dateColumn === 'approve') {
    approveDateJoin = buildArcpApproveDateJoin(opts.startDate, opts.endDate);
    if (!approveDateJoin) {
      condition = appendArcpDateFilter(condition, opts.startDate, opts.endDate, dateColumn);
    }
  } else {
    condition = appendArcpDateFilter(condition, opts.startDate, opts.endDate, dateColumn);
  }

  condition = appendCsvInFilter(condition, 'branch.ncode', opts.branch);
  condition = appendCsvInFilter(condition, 'arcp.nofficeid', opts.franchisee);
  condition = appendCallTypeFilter(condition, opts.callType, 'arcp.ncalltype');
  condition = appendArcpOfficeSecurityFilter(condition, opts.isHod ?? true, opts.assignedOffices ?? []);

  return { condition, approveDateJoin };
}

function buildArcpClaimsFilterCondition(opts: ArcpClaimsQueryOpts): string {
  return buildArcpClaimsFilterParts(opts).condition;
}

const ARCP_INCLUDED_LINES_FILTER_FAST = `
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (ISNULL(arcp.nitemcategory, '') <> '' AND arcp.nitemcategory <> '0')
  )`;

function needsBranchOfficeJoin(opts: ArcpClaimsQueryOpts): boolean {
  const branch = opts.branch;
  return Boolean(branch && branch !== 'All' && branch !== 'undefined' && branch !== 'null');
}

/** Tally-only SQL: aggregate in one pass with lookup labels for service sections. */
function buildArcpClaimsSummarySql(opts: ArcpClaimsQueryOpts): string {
  const { condition, approveDateJoin } = buildArcpClaimsFilterParts(opts);
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const claimMonthExpr = buildArcpClaimMonthExpr(dateColumn);
  const branchJoin = needsBranchOfficeJoin(opts)
    ? 'LEFT JOIN mstoffice branch (NOLOCK) ON o.nunder = branch.ncode'
    : '';
  const isTravelExpr =
    "CASE WHEN ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0' THEN 1 ELSE 0 END";
  const callTypeLabelExpr =
    "ISNULL(NULLIF(LTRIM(RTRIM(fs_ct.vdisplayvalue)), ''), CAST(arcp.ncalltype AS VARCHAR(50)))";
  const itemCategoryLabelExpr = `COALESCE(
    NULLIF(LTRIM(RTRIM(ic.vname)), ''),
    NULLIF(LTRIM(RTRIM(ic.vshortname)), ''),
    CAST(arcp.nitemcategory AS VARCHAR(50))
  )`;
  const localUpcountryLabelExpr = `COALESCE(
    NULLIF(LTRIM(RTRIM(fs_lu.vdisplayvalue)), ''),
    CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
      ${LOCAL_UPCOUNTRY_CASE_SQL}
      ELSE NULL
    END,
    CAST(arcp.nlocalupcountry AS VARCHAR(50))
  )`;

  return `
SELECT
  ${claimMonthExpr} AS claim_month,
  arcp.ncalltype,
  MAX(${callTypeLabelExpr}) AS call_type_label,
  arcp.nitemcategory,
  MAX(${itemCategoryLabelExpr}) AS item_category_label,
  arcp.nlocalupcountry,
  MAX(${localUpcountryLabelExpr}) AS local_upcountry_label,
  ${isTravelExpr} AS is_travel,
  ${MAJOR_MINOR_EXPR} AS major_minor,
  AVG(${SAFE_FLOAT('arcp.ndistancerate')}) AS rate,
  COUNT(DISTINCT arcp.ncode) AS qty,
  SUM(${AMOUNT_PAYABLE_VAL_EXPR}) AS amount_payable,
  SUM(${BRANCH_APPROVED_VAL_EXPR}) AS branch_approved,
  SUM(${HO_APPROVED_VAL_EXPR}) AS ho_approved
FROM trdcalls10ARCP arcp (NOLOCK)
${approveDateJoin}
LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
${branchJoin}
LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
LEFT JOIN mstitemcategory ic (NOLOCK)
  ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
LEFT JOIN mstfixedselection fs_ct (NOLOCK)
  ON CAST(fs_ct.ncode AS VARCHAR(50)) = CAST(arcp.ncalltype AS VARCHAR(50))
  AND fs_ct.vfieldname = 'ncalltype'
LEFT JOIN mstfixedselection fs_lu (NOLOCK)
  ON CAST(fs_lu.ncode AS VARCHAR(50)) = CAST(arcp.nlocalupcountry AS VARCHAR(50))
  AND fs_lu.vfieldname = 'nlocalupcountry'
OUTER APPLY (
  SELECT TOP 1 tf2.ncalls
  FROM trdcalls2fault tf2 (NOLOCK)
  JOIN mstrepair rr (NOLOCK) ON tf2.nrepair = rr.ncode
  WHERE tf2.ncalls = tf.ncalls
    AND tf2.nofficeid = arcp.nofficeid
    AND rr.bmajor = 'True'
) major
WHERE ${condition}
  ${ARCP_NOT_REJECTED}
  ${ARCP_INCLUDED_LINES_FILTER}
GROUP BY
  ${claimMonthExpr},
  arcp.ncalltype,
  arcp.nitemcategory,
  arcp.nlocalupcountry,
  ${isTravelExpr},
  ${MAJOR_MINOR_EXPR}
`.trim();
}

function buildArcpClaimsLineSelectSql(condition: string, approveDateJoin = ''): string {
  return `
  SELECT
    arcp.ncode,
    arcp.vucnno,
    arcp.ncalls2fault,
    tf.ncalls AS call_no,
    arcp.nofficeid,
    COALESCE(NULLIF(LTRIM(RTRIM(branch.vcompanyname)), ''), NULLIF(LTRIM(RTRIM(branch.valiasname)), ''), CAST(branch.ncode AS VARCHAR(50))) AS branch_name,
    COALESCE(NULLIF(LTRIM(RTRIM(o.vcompanyname)), ''), NULLIF(LTRIM(RTRIM(o.valiasname)), ''), CAST(o.ncode AS VARCHAR(50))) AS franchisee_name,
    arcp.dcalllogdatetime,
    arcp.dsolveddatetime,
    arcp.dbmapproveddate,
    arcp.dhoapproveddate,
    arcp.ncalltype,
    ISNULL(NULLIF(LTRIM(RTRIM(fs_ct.vdisplayvalue)), ''), CAST(arcp.ncalltype AS VARCHAR(50))) AS call_type_label,
    arcp.nitemcategory,
    COALESCE(
      NULLIF(LTRIM(RTRIM(ic.vname)), ''),
      NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
    ) AS item_category_label,
    arcp.nlocalupcountry,
    COALESCE(
      NULLIF(LTRIM(RTRIM(fs_lu.vdisplayvalue)), ''),
      CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
        ${LOCAL_UPCOUNTRY_CASE_SQL}
        ELSE NULL
      END
    ) AS local_upcountry_label,
    CASE WHEN ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0' THEN 1 ELSE 0 END AS is_travel,
    ${MAJOR_MINOR_EXPR} AS major_minor,
    ${SAFE_FLOAT('arcp.ndistancerate')} AS rate_val,
    ${SAFE_FLOAT('arcp.ndistance')} AS distance_val,
    ${AMOUNT_PAYABLE_VAL_EXPR} AS amount_payable_val,
    ${BRANCH_APPROVED_VAL_EXPR} AS branch_approved_val,
    ${HO_APPROVED_VAL_EXPR} AS ho_approved_val,
    ${SAFE_FLOAT('arcp.nchargespayable')} AS raw_nchargespayable,
    ${SAFE_FLOAT('arcp.nbmapprovedamt')} AS raw_nbmapprovedamt,
    ${SAFE_FLOAT('arcp.nhoapprovedamt')} AS raw_nhoapprovedamt,
    ${SAFE_FLOAT('arcp.napproval1amount')} AS raw_napproval1amount,
    ${SAFE_FLOAT('arcp.napproval2amount')} AS raw_napproval2amount,
    ROW_NUMBER() OVER (PARTITION BY arcp.ncode ORDER BY arcp.ncode) AS rn
  FROM trdcalls10ARCP arcp (NOLOCK)
  ${approveDateJoin}
  LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
  LEFT JOIN mstoffice branch (NOLOCK) ON o.nunder = branch.ncode
  LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
  LEFT JOIN mstitemcategory ic (NOLOCK)
    ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
  LEFT JOIN mstfixedselection fs_ct (NOLOCK)
    ON CAST(fs_ct.ncode AS VARCHAR(50)) = CAST(arcp.ncalltype AS VARCHAR(50))
    AND fs_ct.vfieldname = 'ncalltype'
  LEFT JOIN mstfixedselection fs_lu (NOLOCK)
    ON CAST(fs_lu.ncode AS VARCHAR(50)) = CAST(arcp.nlocalupcountry AS VARCHAR(50))
    AND fs_lu.vfieldname = 'nlocalupcountry'
  OUTER APPLY (
    SELECT TOP 1 tf2.ncalls
    FROM trdcalls2fault tf2 (NOLOCK)
    JOIN mstrepair rr (NOLOCK) ON tf2.nrepair = rr.ncode
    WHERE tf2.ncalls = tf.ncalls
      AND tf2.nofficeid = arcp.nofficeid
      AND rr.bmajor = 'True'
  ) major
  WHERE ${condition}
    ${ARCP_NOT_REJECTED}
    ${ARCP_INCLUDED_LINES_FILTER}
  `.trim();
}

export type ArcpClaimsDetailRow = {
  vucnno: string;
  calls2fault_code: string;
  call_no: string;
  franchisee_code: string;
  branch_name: string;
  franchisee_name: string;
  call_date: string;
  solve_date: string;
  bm_approved_date: string;
  ho_approved_date: string;
  call_type: string;
  item_category: string;
  local_upcountry: string;
  major_minor: string;
  line_type: string;
  rate: number | null;
  distance: number | null;
  amount_payable: number | null;
  branch_approved: number | null;
  ho_approved: number | null;
  raw_nchargespayable: number | null;
  raw_nbmapprovedamt: number | null;
  raw_nhoapprovedamt: number | null;
  raw_napproval1amount: number | null;
  raw_napproval2amount: number | null;
  summary_section: string;
  summary_sub_row: string;
  payable_minus_branch: number | null;
  payable_minus_ho: number | null;
};

export function buildArcpClaimsRawSql(opts: ArcpClaimsQueryOpts): string {
  return buildArcpClaimsSummarySql(opts);
}

/** Single-pass grand total for verification (same filters as summary tally). */
export function buildArcpClaimsGrandTotalSql(opts: ArcpClaimsQueryOpts): string {
  const { condition, approveDateJoin } = buildArcpClaimsFilterParts(opts);
  const branchJoin = needsBranchOfficeJoin(opts)
    ? 'LEFT JOIN mstoffice branch (NOLOCK) ON o.nunder = branch.ncode'
    : '';

  return `
SELECT
  COUNT(DISTINCT arcp.ncode) AS qty,
  SUM(${AMOUNT_PAYABLE_VAL_EXPR}) AS amount_payable,
  SUM(${BRANCH_APPROVED_VAL_EXPR}) AS branch_approved,
  SUM(${HO_APPROVED_VAL_EXPR}) AS ho_approved
FROM trdcalls10ARCP arcp (NOLOCK)
${approveDateJoin}
LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
${branchJoin}
LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
LEFT JOIN mstitemcategory ic (NOLOCK)
  ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
WHERE ${condition}
  ${ARCP_NOT_REJECTED}
  ${ARCP_INCLUDED_LINES_FILTER}
`.trim();
}

export function buildArcpClaimsDetailSql(opts: ArcpClaimsQueryOpts): string {
  const { condition, approveDateJoin } = buildArcpClaimsFilterParts(opts);

  return `
SELECT
  deduped.vucnno,
  deduped.ncalls2fault AS calls2fault_code,
  deduped.call_no,
  deduped.nofficeid AS franchisee_code,
  deduped.branch_name,
  deduped.franchisee_name,
  deduped.dcalllogdatetime AS call_date,
  deduped.dsolveddatetime AS solve_date,
  deduped.dbmapproveddate AS bm_approved_date,
  deduped.dhoapproveddate AS ho_approved_date,
  deduped.call_type_label AS call_type,
  deduped.item_category_label AS item_category,
  deduped.local_upcountry_label AS local_upcountry,
  deduped.major_minor,
  CASE WHEN deduped.is_travel = 1 THEN 'Travel' ELSE 'Service' END AS line_type,
  deduped.rate_val AS rate,
  deduped.distance_val AS distance,
  deduped.amount_payable_val AS amount_payable,
  deduped.branch_approved_val AS branch_approved,
  deduped.ho_approved_val AS ho_approved,
  deduped.raw_nchargespayable,
  deduped.raw_nbmapprovedamt,
  deduped.raw_nhoapprovedamt,
  deduped.raw_napproval1amount,
  deduped.raw_napproval2amount,
  CASE
    WHEN deduped.is_travel = 1 THEN 'Reimbursement of Travel Expenses'
    WHEN NULLIF(LTRIM(RTRIM(deduped.item_category_label)), '') IS NULL THEN ''
    WHEN NULLIF(LTRIM(RTRIM(deduped.call_type_label)), '') IS NULL THEN deduped.item_category_label
    ELSE deduped.call_type_label + N' – ' + deduped.item_category_label
  END AS summary_section,
  CASE
    WHEN deduped.is_travel = 1 THEN 'Reimbursement of Travel Expenses'
    WHEN deduped.local_upcountry_label IS NOT NULL
      AND LTRIM(RTRIM(deduped.local_upcountry_label)) <> ''
      AND deduped.major_minor IS NOT NULL
      AND LTRIM(RTRIM(deduped.major_minor)) <> ''
      THEN deduped.local_upcountry_label + N' - ' + deduped.major_minor
    WHEN deduped.local_upcountry_label IS NOT NULL AND LTRIM(RTRIM(deduped.local_upcountry_label)) <> ''
      THEN deduped.local_upcountry_label
    ELSE ISNULL(deduped.major_minor, 'General')
  END AS summary_sub_row,
  deduped.amount_payable_val - deduped.branch_approved_val AS payable_minus_branch,
  deduped.amount_payable_val - deduped.ho_approved_val AS payable_minus_ho
FROM (
  ${buildArcpClaimsLineSelectSql(condition, approveDateJoin)}
) deduped
WHERE deduped.rn = 1
ORDER BY
  deduped.call_type_label,
  deduped.item_category_label,
  deduped.local_upcountry_label,
  deduped.major_minor,
  deduped.vucnno
`.trim();
}

function toAggregateNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatArcpDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function arcpDateSpanDays(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

export function splitArcpDateRange(
  startDate: string,
  endDate: string,
  chunkDays = ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS
): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
    return [{ start: startDate, end: endDate }];
  }

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime());
    }
    chunks.push({
      start: formatArcpDateYmd(cursor),
      end: formatArcpDateYmd(chunkEnd),
    });
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

/** Calendar-month chunks — one tally query per month for wide ranges. */
export function splitArcpDateRangeByMonth(
  startDate: string,
  endDate: string
): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) {
    return [{ start: startDate, end: endDate }];
  }

  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const chunkEnd = monthEnd > end ? end : monthEnd;
    chunks.push({
      start: formatArcpDateYmd(cursor),
      end: formatArcpDateYmd(chunkEnd),
    });
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

export function countArcpCalendarMonths(startDate: string, endDate: string): number {
  return splitArcpDateRangeByMonth(startDate, endDate).length;
}

/** Pick query windows: approve date always uses small slices; call/solve uses months when wide. */
export function planArcpSummaryDateChunks(opts: ArcpClaimsQueryOpts): { start: string; end: string }[] {
  if (!opts.startDate || !opts.endDate) {
    return [{ start: opts.startDate || '', end: opts.endDate || '' }];
  }

  const span = arcpDateSpanDays(opts.startDate, opts.endDate);
  if (span == null || span <= 0) {
    return [{ start: opts.startDate, end: opts.endDate }];
  }

  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  if (dateColumn === 'approve') {
    if (span <= ARCP_APPROVE_CHUNK_DAYS) {
      return [{ start: opts.startDate, end: opts.endDate }];
    }
    return splitArcpDateRange(opts.startDate, opts.endDate, ARCP_APPROVE_CHUNK_DAYS);
  }

  if (span <= ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS) {
    return [{ start: opts.startDate, end: opts.endDate }];
  }

  return splitArcpDateRangeByMonth(opts.startDate, opts.endDate);
}

export type ArcpLoadPlan = {
  spanDays: number;
  chunkCount: number;
  isLongLoad: boolean;
  estimateMs: number;
  chunks: { start: string; end: string }[];
};

/** Client-side load planning for progress UI and upfront validation. */
export function estimateArcpLoadPlan(opts: ArcpClaimsQueryOpts): ArcpLoadPlan {
  const chunks = planArcpSummaryDateChunks(opts);
  const span = arcpDateSpanDays(opts.startDate ?? null, opts.endDate ?? null) ?? 0;
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const perChunkMs = dateColumn === 'approve' ? 6500 : 4500;

  return {
    spanDays: span,
    chunkCount: chunks.length,
    isLongLoad: chunks.length > 1 || span > ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS,
    estimateMs: chunks.length * perChunkMs,
    chunks,
  };
}

/** Detail CSV export is heavier — ~10–15s per weekly chunk on approve date. */
export function estimateArcpDetailLoadPlan(opts: ArcpClaimsQueryOpts): ArcpLoadPlan {
  const chunks = planArcpSummaryDateChunks(opts);
  const span = arcpDateSpanDays(opts.startDate ?? null, opts.endDate ?? null) ?? 0;
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const perChunkMs = dateColumn === 'approve' ? 12000 : 8000;

  return {
    spanDays: span,
    chunkCount: chunks.length,
    isLongLoad: chunks.length > 1 || span > ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS,
    estimateMs: chunks.length * perChunkMs,
    chunks,
  };
}

export function mergeArcpDetailRows(rows: ArcpClaimsDetailRow[]): ArcpClaimsDetailRow[] {
  const byUcn = new Map<string, ArcpClaimsDetailRow>();
  for (const row of rows) {
    const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
    if (!byUcn.has(key)) byUcn.set(key, row);
  }
  return Array.from(byUcn.values());
}

function preferAggregateLabel(current: string, incoming: string): string {
  const left = current.trim();
  const right = incoming.trim();
  if (!right) return left;
  if (!left) return right;
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && !rightNumeric) return right;
  if (!leftNumeric && rightNumeric) return left;
  return right.length > left.length ? right : left;
}

/** Stable merge key — labels can differ between CRM chunks (numeric vs resolved text). */
function aggregateGroupKey(row: ArcpClaimsAggregateRow): string {
  return [
    String(row.ncalltype ?? ''),
    String(row.nitemcategory ?? ''),
    String(row.nlocalupcountry ?? ''),
    String(row.is_travel ?? 0),
    String(row.major_minor ?? ''),
  ].join('\0');
}

export function mergeArcpAggregateRows(rows: ArcpClaimsAggregateRow[]): ArcpClaimsAggregateRow[] {
  const map = new Map<
    string,
    ArcpClaimsAggregateRow & { rateWeighted: number; rateQty: number }
  >();

  for (const row of rows) {
    const key = aggregateGroupKey(row);
    const qty = Number(row.qty ?? 0);
    const rate = toAggregateNumber(row.rate);
    const amountPayable = toAggregateNumber(row.amount_payable) ?? 0;
    const branchApproved = toAggregateNumber(row.branch_approved) ?? 0;
    const hoApproved = toAggregateNumber(row.ho_approved) ?? 0;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...row,
        qty,
        amount_payable: amountPayable,
        branch_approved: branchApproved,
        ho_approved: hoApproved,
        rate,
        rateWeighted: rate != null && qty > 0 ? rate * qty : 0,
        rateQty: rate != null && qty > 0 ? qty : 0,
      });
      continue;
    }

    existing.qty = Number(existing.qty ?? 0) + qty;
    existing.amount_payable = (toAggregateNumber(existing.amount_payable) ?? 0) + amountPayable;
    existing.branch_approved = (toAggregateNumber(existing.branch_approved) ?? 0) + branchApproved;
    existing.ho_approved = (toAggregateNumber(existing.ho_approved) ?? 0) + hoApproved;
    existing.call_type_label = preferAggregateLabel(
      String(existing.call_type_label ?? ''),
      String(row.call_type_label ?? '')
    );
    existing.item_category_label = preferAggregateLabel(
      String(existing.item_category_label ?? ''),
      String(row.item_category_label ?? '')
    );
    existing.local_upcountry_label = preferAggregateLabel(
      String(existing.local_upcountry_label ?? ''),
      String(row.local_upcountry_label ?? '')
    );
    if (rate != null && qty > 0) {
      existing.rateWeighted += rate * qty;
      existing.rateQty += qty;
    }
    existing.rate =
      existing.rateQty > 0 ? existing.rateWeighted / existing.rateQty : existing.rate;
  }

  return Array.from(map.values()).map(({ rateWeighted: _rw, rateQty: _rq, ...row }) => row);
}

export function parseArcpAggregateRows(raw: Record<string, unknown>[]): ArcpClaimsAggregateRow[] {
  return raw.map((row) => {
    const localCode = String(row.nlocalupcountry ?? '').trim();
    const localLabel =
      LOCAL_UPCOUNTRY_NCODE_LABELS[localCode] ??
      String(row.local_upcountry_label ?? localCode ?? '');

    return {
      claim_month: String(row.claim_month ?? 'unknown').trim() || 'unknown',
      ncalltype: String(row.ncalltype ?? ''),
      call_type_label: String(row.call_type_label ?? row.ncalltype ?? ''),
      nitemcategory: String(row.nitemcategory ?? ''),
      item_category_label: String(row.item_category_label ?? row.nitemcategory ?? ''),
      nlocalupcountry: localCode,
      local_upcountry_label: localLabel,
      is_travel: Number(row.is_travel ?? 0),
      major_minor: String(row.major_minor ?? 'Minor'),
      rate: toAggregateNumber(row.rate),
      qty: Number(row.qty ?? 0),
      amount_payable: toAggregateNumber(row.amount_payable),
      branch_approved: toAggregateNumber(row.branch_approved),
      ho_approved: toAggregateNumber(row.ho_approved),
    };
  });
}

export function parseArcpDetailRows(raw: Record<string, unknown>[]): ArcpClaimsDetailRow[] {
  return raw.map((row) => ({
    vucnno: String(row.vucnno ?? ''),
    calls2fault_code: String(row.calls2fault_code ?? ''),
    call_no: String(row.call_no ?? ''),
    franchisee_code: String(row.franchisee_code ?? ''),
    branch_name: String(row.branch_name ?? ''),
    franchisee_name: String(row.franchisee_name ?? ''),
    call_date: String(row.call_date ?? ''),
    solve_date: String(row.solve_date ?? ''),
    bm_approved_date: String(row.bm_approved_date ?? ''),
    ho_approved_date: String(row.ho_approved_date ?? ''),
    call_type: String(row.call_type ?? ''),
    item_category: String(row.item_category ?? ''),
    local_upcountry: String(row.local_upcountry ?? ''),
    major_minor: String(row.major_minor ?? ''),
    line_type: String(row.line_type ?? ''),
    rate: toAggregateNumber(row.rate),
    distance: toAggregateNumber(row.distance),
    amount_payable: toAggregateNumber(row.amount_payable),
    branch_approved: toAggregateNumber(row.branch_approved),
    ho_approved: toAggregateNumber(row.ho_approved),
    raw_nchargespayable: toAggregateNumber(row.raw_nchargespayable),
    raw_nbmapprovedamt: toAggregateNumber(row.raw_nbmapprovedamt),
    raw_nhoapprovedamt: toAggregateNumber(row.raw_nhoapprovedamt),
    raw_napproval1amount: toAggregateNumber(row.raw_napproval1amount),
    raw_napproval2amount: toAggregateNumber(row.raw_napproval2amount),
    summary_section: String(row.summary_section ?? ''),
    summary_sub_row: String(row.summary_sub_row ?? ''),
    payable_minus_branch: toAggregateNumber(row.payable_minus_branch),
    payable_minus_ho: toAggregateNumber(row.payable_minus_ho),
  }));
}
