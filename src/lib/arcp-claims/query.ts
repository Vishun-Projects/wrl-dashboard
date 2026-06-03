import {
  planArcpCoverageSegments,
  type ArcpCoverageDateColumn,
  type ArcpPostgresCoverage,
} from '@/lib/read-model/arcp/coverage-shared';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import {
  appendCallTypeFilter,
} from '@/lib/trhcalls/query';

export type ArcpDateFilterColumn =
  | 'dcalllogdatetime'
  | 'dsolveddatetime'
  | 'bm_approved_at'
  | 'ho_approved_at';

export const ARCP_DATE_FILTER_OPTIONS: { value: ArcpDateFilterColumn; label: string }[] = [
  { value: 'dcalllogdatetime', label: 'Call Date' },
  { value: 'dsolveddatetime', label: 'Call Solve Date' },
  { value: 'bm_approved_at', label: 'BM Call Approved' },
  { value: 'ho_approved_at', label: 'HO Call Approved' },
];

export function isArcpApproveDateColumn(
  column: string | null | undefined
): column is 'bm_approved_at' | 'ho_approved_at' {
  return column === 'bm_approved_at' || column === 'ho_approved_at';
}

/** Up to ~2 months completes in one CRM query (~4–5s). Wider spans split automatically. */
export const ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS = 62;
/** BM/HO approve: weekly CRM windows (Vercel default). Backfill uses its own 1-day env. */
export const ARCP_APPROVE_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.ARCP_APPROVE_CHUNK_DAYS ?? 7) || 7
);
/** Parallel CRM requests for call/solve date loads (UI + server). */
export const ARCP_LOAD_CONCURRENCY = 3;
/** Approve-date queries are heavy — run one CRM request at a time to avoid 30s SQL timeouts. */
export const ARCP_APPROVE_LOAD_CONCURRENCY = 1;
/** UI CRM fallback: skip label joins in CRM; resolve from Postgres dims after fetch. */
export const ARCP_CRM_UI_LIGHTWEIGHT = process.env.ARCP_CRM_UI_LIGHTWEIGHT !== 'false';

export function resolveArcpLoadConcurrency(opts: ArcpClaimsQueryOpts): number {
  return isArcpApproveDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn))
    ? ARCP_APPROVE_LOAD_CONCURRENCY
    : ARCP_LOAD_CONCURRENCY;
}
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
  /** Split heavy CRM loads by arcp.ncode modulo (OOM / timeout recovery). */
  ncodeShard?: { index: number; count: number };
  /** Report CRM fallback only — fast SQL + smaller date windows (never set on backfill). */
  crmUiFast?: boolean;
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
  if (column === 'dsolveddatetime') return column;
  if (column === 'bm_approved_at' || column === 'ho_approved_at') return column;
  // Legacy URL param from combined "Call Approve Date" filter
  if (column === 'approve') return 'bm_approved_at';
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

  if (dateColumn === 'bm_approved_at') {
    next += ` AND ${ARCP_BM_MARKED_EXPR}`;
    next += ` AND ${ARCP_BM_APPROVE_DT_EXPR} IS NOT NULL`;
    if (startDate) {
      const start = escapeSql(startDate);
      next += ` AND ${ARCP_BM_APPROVE_DT_EXPR} >= '${start}'`;
    }
    if (endDate) {
      const end = escapeSql(endDate);
      next += ` AND ${ARCP_BM_APPROVE_DT_EXPR} <= '${end}${endSuffix}'`;
    }
    return next;
  }

  if (dateColumn === 'ho_approved_at') {
    next += ` AND (
      NULLIF(LTRIM(RTRIM(CAST(arcp.dhoapproveddate AS VARCHAR(30)))), '') IS NOT NULL
      OR ISNULL(arcp.bapprovedho, '0') IN ('1', 'True', 'true')
      OR TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(arcp.nhoapprovedamt AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) > 0
    )`;
    next += ` AND ${ARCP_HO_APPROVE_DT_EXPR} IS NOT NULL`;
    if (startDate) {
      const start = escapeSql(startDate);
      next += ` AND ${ARCP_HO_APPROVE_DT_EXPR} >= '${start}'`;
    }
    if (endDate) {
      const end = escapeSql(endDate);
      next += ` AND ${ARCP_HO_APPROVE_DT_EXPR} <= '${end}${endSuffix}'`;
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

/**
 * Must match arcpDetailDedupeKey — vucnno first (detail export ~42 rows / 26480).
 * Do not group by calls2fault alone; that over-merges and drops branch (~16500).
 */
const ARCP_CALL_KEY_EXPR = `
  COALESCE(
    NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), ''),
    NULLIF(LTRIM(RTRIM(CAST(tf.ncalls AS VARCHAR(50)))), ''),
    NULLIF(LTRIM(RTRIM(CAST(arcp.ncalls2fault AS VARCHAR(50)))), '') + ':' + CAST(arcp.nofficeid AS VARCHAR(50))
  )`;

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

/** CRM stores approve timestamps as dd/mm/yyyy text; fallback to stage approval timestamps. */
const ARCP_APPROVAL1_DT_EXPR = `COALESCE(
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''), 126),
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''), 103)
)`;
const ARCP_APPROVAL2_DT_EXPR = `COALESCE(
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval2on AS VARCHAR(30)))), ''), 126),
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval2on AS VARCHAR(30)))), ''), 103)
)`;
const ARCP_HO_APPROVE_DT_EXPR = `COALESCE(
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dhoapproveddate AS VARCHAR(30)))), ''), 103),
  ${ARCP_APPROVAL2_DT_EXPR}
)`;
const ARCP_BM_APPROVE_DT_EXPR = `COALESCE(
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''), 103),
  ${ARCP_APPROVAL1_DT_EXPR}
)`;
const ARCP_BM_MARKED_EXPR = `(
  NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), '') IS NOT NULL
  OR ISNULL(arcp.bapproved, '0') IN ('1', 'True', 'true')
  OR TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(arcp.nbmapprovedamt AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) > 0
)`;
const ARCP_EFFECTIVE_APPROVE_DATE_EXPR = `COALESCE(${ARCP_HO_APPROVE_DT_EXPR}, ${ARCP_BM_APPROVE_DT_EXPR})`;

function buildArcpClaimMonthExpr(dateColumn: ArcpDateFilterColumn): string {
  const parseDt = (column: string) =>
    `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.${column} AS VARCHAR(30)))), ''), 103)`;

  const dateExpr =
    dateColumn === 'bm_approved_at'
      ? ARCP_BM_APPROVE_DT_EXPR
      : dateColumn === 'ho_approved_at'
        ? ARCP_HO_APPROVE_DT_EXPR
        : dateColumn === 'dsolveddatetime'
          ? parseDt('dsolveddatetime')
          : parseDt('dcalllogdatetime');

  return `ISNULL(FORMAT(${dateExpr}, 'yyyy-MM'), 'unknown')`;
}

function buildArcpClaimsFilterParts(opts: ArcpClaimsQueryOpts): {
  condition: string;
} {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  let condition = "arcp.nofficetype = '3'";

  condition = appendArcpDateFilter(condition, opts.startDate, opts.endDate, dateColumn);

  condition = appendCsvInFilter(condition, 'o.nunder', opts.branch);
  condition = appendCsvInFilter(condition, 'arcp.nofficeid', opts.franchisee);
  condition = appendCallTypeFilter(condition, opts.callType, 'arcp.ncalltype');
  condition = appendArcpOfficeSecurityFilter(condition, opts.isHod ?? true, opts.assignedOffices ?? []);

  if (opts.ncodeShard && opts.ncodeShard.count > 0) {
    condition += ` AND (arcp.ncode % ${opts.ncodeShard.count}) = ${opts.ncodeShard.index}`;
  }

  return { condition };
}

function buildArcpClaimsFilterCondition(opts: ArcpClaimsQueryOpts): string {
  return buildArcpClaimsFilterParts(opts).condition;
}

/** Lightweight eligibility — same rules as full filter, EXISTS avoids ic join fan-out. */
const ARCP_INCLUDED_LINES_FILTER_EXISTS = `
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (
      ISNULL(arcp.nitemcategory, '') <> ''
      AND arcp.nitemcategory <> '0'
      AND EXISTS (
        SELECT 1 FROM mstitemcategory ic (NOLOCK)
        WHERE CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
          AND COALESCE(
            NULLIF(LTRIM(RTRIM(ic.vname)), ''),
            NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
          ) IS NOT NULL
      )
    )
  )`;

const ARCP_OFFICE_JOIN = `LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode`;

const ARCP_MAJOR_APPLY = `
OUTER APPLY (
  SELECT TOP 1 tf2.ncalls
  FROM trdcalls2fault tf2 (NOLOCK)
  JOIN mstrepair rr (NOLOCK) ON tf2.nrepair = rr.ncode
  WHERE tf2.ncalls = tf.ncalls
    AND tf2.nofficeid = arcp.nofficeid
    AND rr.bmajor = 'True'
) major`;

/** TOP 1 lookups — avoids join fan-out and nested aggregates (CRM SQL limitations). */
const ARCP_CALL_TYPE_LABEL_APPLY = `
OUTER APPLY (
  SELECT TOP 1 NULLIF(LTRIM(RTRIM(fs.vdisplayvalue)), '') AS label
  FROM mstfixedselection fs (NOLOCK)
  WHERE CAST(fs.ncode AS VARCHAR(50)) = CAST(arcp.ncalltype AS VARCHAR(50))
    AND fs.vfieldname = 'ncalltype'
) fs_ct`;

const ARCP_ITEM_CATEGORY_LABEL_APPLY = `
OUTER APPLY (
  SELECT TOP 1 COALESCE(
    NULLIF(LTRIM(RTRIM(ic.vname)), ''),
    NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
  ) AS label
  FROM mstitemcategory ic (NOLOCK)
  WHERE CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
) ic_lbl`;

const ARCP_LOCAL_UPCOUNTRY_LABEL_APPLY = `
OUTER APPLY (
  SELECT TOP 1 NULLIF(LTRIM(RTRIM(fs.vdisplayvalue)), '') AS label
  FROM mstfixedselection fs (NOLOCK)
  WHERE CAST(fs.ncode AS VARCHAR(50)) = CAST(arcp.nlocalupcountry AS VARCHAR(50))
    AND fs.vfieldname = 'nlocalupcountry'
) fs_lu`;

/** Sort key for detail export dedupe — first row per call_key wins (see mergeArcpDetailRows). */
function buildArcpLineSortTsExpr(dateColumn: ArcpDateFilterColumn): string {
  if (dateColumn === 'bm_approved_at') return ARCP_BM_APPROVE_DT_EXPR;
  if (dateColumn === 'ho_approved_at') return ARCP_HO_APPROVE_DT_EXPR;
  if (dateColumn === 'dsolveddatetime') {
    return `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dsolveddatetime AS VARCHAR(30)))), ''), 103)`;
  }
  return `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dcalllogdatetime AS VARCHAR(30)))), ''), 103)`;
}

/** One row per ARCP line — nested subquery (CRM rawSql cannot use WITH / CTE). */
function buildArcpClaimsLinesSubquery(
  condition: string,
  claimMonthExpr: string,
  isTravelExpr: string,
  lightweight = false,
  dateColumn: ArcpDateFilterColumn = 'dcalllogdatetime'
): string {
  const sortTsExpr = buildArcpLineSortTsExpr(dateColumn);
  const callTypeLabelExpr = lightweight
    ? 'MAX(CAST(arcp.ncalltype AS VARCHAR(50)))'
    : 'MAX(ISNULL(fs_ct.label, CAST(arcp.ncalltype AS VARCHAR(50))))';
  const itemCategoryLabelExpr = lightweight
    ? 'MAX(CAST(arcp.nitemcategory AS VARCHAR(50)))'
    : 'MAX(COALESCE(ic_lbl.label, CAST(arcp.nitemcategory AS VARCHAR(50))))';
  const localUpcountryLabelExpr = lightweight
    ? `MAX(CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
        ${LOCAL_UPCOUNTRY_CASE_SQL}
        ELSE CAST(arcp.nlocalupcountry AS VARCHAR(50))
      END)`
    : `MAX(COALESCE(
      fs_lu.label,
      CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
        ${LOCAL_UPCOUNTRY_CASE_SQL}
        ELSE NULL
      END,
      CAST(arcp.nlocalupcountry AS VARCHAR(50))
    ))`;

  const labelApplies = lightweight
    ? ''
    : `${ARCP_CALL_TYPE_LABEL_APPLY}${ARCP_ITEM_CATEGORY_LABEL_APPLY}${ARCP_LOCAL_UPCOUNTRY_LABEL_APPLY}`;

  return `
  SELECT
    arcp.ncode,
    ${claimMonthExpr} AS claim_month,
    arcp.ncalltype,
    arcp.nitemcategory,
    arcp.nlocalupcountry,
    ${isTravelExpr} AS is_travel,
    ${MAJOR_MINOR_EXPR} AS major_minor,
    ${callTypeLabelExpr} AS call_type_label,
    ${itemCategoryLabelExpr} AS item_category_label,
    ${localUpcountryLabelExpr} AS local_upcountry_label,
    MAX(${SAFE_FLOAT('arcp.ndistancerate')}) AS rate_val,
    MAX(${AMOUNT_PAYABLE_VAL_EXPR}) AS amount_payable,
    MAX(${BRANCH_APPROVED_VAL_EXPR}) AS branch_approved,
    MAX(${HO_APPROVED_VAL_EXPR}) AS ho_approved,
    MAX(${ARCP_CALL_KEY_EXPR}) AS call_key,
    MAX(${sortTsExpr}) AS sort_ts
  FROM trdcalls10ARCP arcp (NOLOCK)
  ${ARCP_OFFICE_JOIN}
  LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
  ${ARCP_MAJOR_APPLY}
  ${labelApplies}
  WHERE ${condition}
    ${ARCP_NOT_REJECTED}
    ${ARCP_INCLUDED_LINES_FILTER_EXISTS}
  GROUP BY
    arcp.ncode,
    ${claimMonthExpr},
    arcp.ncalltype,
    arcp.nitemcategory,
    arcp.nlocalupcountry,
    ${isTravelExpr},
    ${MAJOR_MINOR_EXPR}
  `.trim();
}

function useCrmUiLightweightSql(opts: ArcpClaimsQueryOpts): boolean {
  return Boolean(opts.crmUiFast && ARCP_CRM_UI_LIGHTWEIGHT);
}

/** One row per call — same winner as detail CSV (mergeArcpDetailRows / export sort order). */
function buildArcpClaimsWinningLinesSubquery(linesSubquery: string): string {
  return `
SELECT
  ranked.claim_month,
  ranked.ncalltype,
  ranked.call_type_label,
  ranked.nitemcategory,
  ranked.item_category_label,
  ranked.nlocalupcountry,
  ranked.local_upcountry_label,
  ranked.is_travel,
  ranked.major_minor,
  ranked.branch_approved,
  ranked.ho_approved
FROM (
  SELECT
    al.*,
    ROW_NUMBER() OVER (
      PARTITION BY al.call_key
      ORDER BY al.sort_ts DESC, al.ncode DESC
    ) AS rn
  FROM (
${linesSubquery}
  ) al
) ranked
WHERE ranked.rn = 1
`.trim();
}

/** Qty and amount payable from every line; branch/HO come from winning-lines union below. */
function buildArcpClaimsLineBucketSubquery(linesSubquery: string): string {
  return `
SELECT
  al.claim_month,
  al.ncalltype,
  MAX(al.call_type_label) AS call_type_label,
  al.nitemcategory,
  MAX(al.item_category_label) AS item_category_label,
  al.nlocalupcountry,
  MAX(al.local_upcountry_label) AS local_upcountry_label,
  al.is_travel,
  al.major_minor,
  COUNT(DISTINCT al.ncode) AS line_qty,
  SUM(al.amount_payable) AS amount_payable,
  CAST(0 AS FLOAT) AS branch_approved,
  CAST(0 AS FLOAT) AS ho_approved,
  AVG(NULLIF(al.rate_val, 0)) AS rate_val
FROM (
${linesSubquery}
) al
GROUP BY
  al.claim_month,
  al.ncalltype,
  al.nitemcategory,
  al.nlocalupcountry,
  al.is_travel,
  al.major_minor
`.trim();
}

/** Tally-only SQL: aggregate in one pass with lookup labels for service sections. */
function buildArcpClaimsSummarySql(opts: ArcpClaimsQueryOpts): string {
  const { condition } = buildArcpClaimsFilterParts(opts);
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const claimMonthExpr = buildArcpClaimMonthExpr(dateColumn);
  const isTravelExpr =
    "CASE WHEN ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0' THEN 1 ELSE 0 END";
  const linesSubquery = buildArcpClaimsLinesSubquery(
    condition,
    claimMonthExpr,
    isTravelExpr,
    useCrmUiLightweightSql(opts),
    dateColumn
  );
  const lineBucketSubquery = buildArcpClaimsLineBucketSubquery(linesSubquery);
  const winningLinesSubquery = buildArcpClaimsWinningLinesSubquery(linesSubquery);
  return `
SELECT
  combined.claim_month,
  combined.ncalltype,
  MAX(combined.call_type_label) AS call_type_label,
  combined.nitemcategory,
  MAX(combined.item_category_label) AS item_category_label,
  combined.nlocalupcountry,
  MAX(combined.local_upcountry_label) AS local_upcountry_label,
  combined.is_travel,
  combined.major_minor,
  AVG(NULLIF(combined.rate_val, 0)) AS rate,
  SUM(combined.line_qty) AS qty,
  SUM(combined.amount_payable) AS amount_payable,
  SUM(combined.branch_approved) AS branch_approved,
  SUM(combined.ho_approved) AS ho_approved
FROM (
  SELECT
    lb.claim_month,
    lb.ncalltype,
    lb.call_type_label,
    lb.nitemcategory,
    lb.item_category_label,
    lb.nlocalupcountry,
    lb.local_upcountry_label,
    lb.is_travel,
    lb.major_minor,
    lb.line_qty,
    lb.amount_payable,
    lb.branch_approved,
    lb.ho_approved,
    lb.rate_val
  FROM (
${lineBucketSubquery}
  ) lb
  UNION ALL
  SELECT
    wl.claim_month,
    wl.ncalltype,
    wl.call_type_label,
    wl.nitemcategory,
    wl.item_category_label,
    wl.nlocalupcountry,
    wl.local_upcountry_label,
    wl.is_travel,
    wl.major_minor,
    0 AS line_qty,
    0 AS amount_payable,
    wl.branch_approved,
    wl.ho_approved,
    NULL AS rate_val
  FROM (
${winningLinesSubquery}
  ) wl
) combined
GROUP BY
  combined.claim_month,
  combined.ncalltype,
  combined.nitemcategory,
  combined.nlocalupcountry,
  combined.is_travel,
  combined.major_minor
`.trim();
}

/** Detail rows for UI CRM fallback — no mstfixedselection / itemcategory joins in CRM. */
function buildArcpClaimsLineSelectSqlFast(condition: string): string {
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
    CAST(arcp.ncalltype AS VARCHAR(50)) AS call_type_label,
    CAST(arcp.nitemcategory AS VARCHAR(50)) AS item_category_label,
    CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
        ${LOCAL_UPCOUNTRY_CASE_SQL}
        ELSE CAST(arcp.nlocalupcountry AS VARCHAR(50))
      END AS local_upcountry_label,
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
  LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
  LEFT JOIN mstoffice branch (NOLOCK) ON o.nunder = branch.ncode
  LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
  ${ARCP_MAJOR_APPLY}
  WHERE ${condition}
    ${ARCP_NOT_REJECTED}
    ${ARCP_INCLUDED_LINES_FILTER_EXISTS}
  `.trim();
}

function buildArcpClaimsLineSelectSql(condition: string): string {
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
  const { condition } = buildArcpClaimsFilterParts(opts);
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const claimMonthExpr = buildArcpClaimMonthExpr(dateColumn);
  const isTravelExpr =
    "CASE WHEN ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0' THEN 1 ELSE 0 END";
  const linesSubquery = buildArcpClaimsLinesSubquery(
    condition,
    claimMonthExpr,
    isTravelExpr,
    useCrmUiLightweightSql(opts),
    dateColumn
  );
  const winningLinesSubquery = buildArcpClaimsWinningLinesSubquery(linesSubquery);

  return `
SELECT
  (SELECT COUNT(DISTINCT al.ncode) FROM (
${linesSubquery}
  ) al) AS line_count,
  (SELECT COUNT(DISTINCT al.ncode) FROM (
${linesSubquery}
  ) al WHERE al.is_travel = 1) AS travel_line_count,
  (SELECT SUM(al.amount_payable) FROM (
${linesSubquery}
  ) al) AS amount_payable,
  (SELECT SUM(wl.branch_approved) FROM (
${winningLinesSubquery}
  ) wl) AS branch_approved,
  (SELECT SUM(wl.ho_approved) FROM (
${winningLinesSubquery}
  ) wl) AS ho_approved
`.trim();
}

export type ArcpGrandTotals = {
  /** Distinct claim lines (service + travel). */
  lineCount: number;
  serviceLineCount: number;
  travelLineCount: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

export function parseArcpGrandTotals(raw: Record<string, unknown>): ArcpGrandTotals {
  const lineCount = Number(raw.line_count ?? raw.qty ?? 0);
  const travelLineCount = Number(raw.travel_line_count ?? 0);
  return {
    lineCount,
    serviceLineCount: Math.max(0, lineCount - travelLineCount),
    travelLineCount,
    amountPayable: Number(raw.amount_payable ?? 0),
    branchApproved: Number(raw.branch_approved ?? 0),
    hoApproved: Number(raw.ho_approved ?? 0),
  };
}

/** Summary cards + CSV must match: sum the same merged aggregate rows as the tally export. */
export function deriveArcpGrandTotalsFromAggregates(
  rows: ArcpClaimsAggregateRow[]
): ArcpGrandTotals {
  let serviceLineCount = 0;
  let travelLineCount = 0;
  let amountPayable = 0;
  let branchApproved = 0;
  let hoApproved = 0;

  for (const row of rows) {
    const qty = Number(row.qty) || 0;
    if (Number(row.is_travel) === 1) {
      travelLineCount += qty;
    } else {
      serviceLineCount += qty;
    }
    amountPayable += Number(row.amount_payable) || 0;
    branchApproved += Number(row.branch_approved) || 0;
    hoApproved += Number(row.ho_approved) || 0;
  }

  return {
    lineCount: serviceLineCount + travelLineCount,
    serviceLineCount,
    travelLineCount,
    amountPayable,
    branchApproved,
    hoApproved,
  };
}

export function buildArcpClaimsDetailSql(opts: ArcpClaimsQueryOpts): string {
  const { condition } = buildArcpClaimsFilterParts(opts);
  const lineSelect = useCrmUiLightweightSql(opts)
    ? buildArcpClaimsLineSelectSqlFast(condition)
    : buildArcpClaimsLineSelectSql(condition);

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
  ${lineSelect}
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
  if (isArcpApproveDateColumn(dateColumn)) {
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
  /** Periods that may fall back to live CRM when Postgres has no rows for that window. */
  crmChunkCount: number;
};

export type ArcpLoadEstimateHints = {
  usePostgres?: boolean;
  coverage?: ArcpPostgresCoverage | null;
};

/** CRM chunk count from Postgres coverage gaps (not the full UI chunk list). */
function countLikelyCrmFallbackChunks(
  chunks: { start: string; end: string }[],
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): number {
  if (!hints?.usePostgres || !hints.coverage || hints.coverage.rowCount === 0) {
    return chunks.length;
  }
  if (!opts.startDate || !opts.endDate) return 0;

  const dateColumn = resolveArcpDateFilterColumn(
    opts.dateFilterColumn
  ) as ArcpCoverageDateColumn;
  const segments = planArcpCoverageSegments(
    opts.startDate,
    opts.endDate,
    hints.coverage,
    dateColumn
  );

  let crmChunks = 0;
  for (const segment of segments) {
    if (segment.mode !== 'crm') continue;
    crmChunks += planArcpSummaryDateChunks({
      ...opts,
      startDate: segment.start,
      endDate: segment.end,
    }).length;
  }
  return crmChunks > 0 ? crmChunks : 0;
}

/** Client-side load planning for progress UI and upfront validation. */
export function estimateArcpLoadPlan(
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): ArcpLoadPlan {
  const chunks = planArcpSummaryDateChunks(opts);
  const span = arcpDateSpanDays(opts.startDate ?? null, opts.endDate ?? null) ?? 0;
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const likelyCrm = countLikelyCrmFallbackChunks(chunks, opts, hints);
  const crmPerChunkMs = isArcpApproveDateColumn(dateColumn) ? 18000 : 12000;
  const concurrency = likelyCrm > 1 ? resolveArcpLoadConcurrency(opts) : 1;
  const postgresReady = Boolean(hints?.usePostgres && hints.coverage && hints.coverage.rowCount > 0);
  const estimateMs = postgresReady
    ? 3000 + Math.ceil(likelyCrm / concurrency) * crmPerChunkMs
    : Math.ceil(chunks.length / concurrency) * crmPerChunkMs;

  return {
    spanDays: span,
    chunkCount: chunks.length,
    isLongLoad:
      likelyCrm > 0 ||
      (!postgresReady &&
        (chunks.length > 1 || span > ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS)),
    estimateMs,
    chunks,
    crmChunkCount: likelyCrm,
  };
}

/**
 * When arcp_lines_hot has rows, one API call + one Postgres query is enough for any
 * date span (including branch/franchisee filters). Avoids N parallel weekly CRM requests.
 */
export function shouldUseClientSideArcpChunks(
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): boolean {
  /** One server round-trip until coverage is known — avoids weekly chunk fan-out + tally inflation. */
  if (hints?.usePostgres && !hints.coverage) {
    return false;
  }
  if (hints?.usePostgres && hints.coverage && hints.coverage.rowCount > 0) {
    return false;
  }
  const plan = estimateArcpLoadPlan(opts, hints);
  return plan.chunkCount > 1;
}

/** UI load plan: single round-trip when Postgres serves the tally. */
export function resolveArcpClientLoadPlan(
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): ArcpLoadPlan {
  const plan = estimateArcpLoadPlan(opts, hints);
  if (shouldUseClientSideArcpChunks(opts, hints)) return plan;
  const start = opts.startDate ?? '';
  const end = opts.endDate ?? '';
  const scoped =
    Boolean(opts.franchisee?.trim()) ||
    Boolean(opts.branch?.trim()) ||
    (opts.callType && opts.callType !== 'All');
  const estimateMs = scoped ? 2500 : Math.min(plan.estimateMs, 8000);
  return {
    ...plan,
    chunkCount: 1,
    isLongLoad: false,
    estimateMs,
    chunks: [{ start, end }],
    crmChunkCount: plan.crmChunkCount,
  };
}

/** Detail CSV export is heavier — ~10–15s per weekly chunk on approve date. */
export function estimateArcpDetailLoadPlan(
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): ArcpLoadPlan {
  const chunks = planArcpSummaryDateChunks(opts);
  const span = arcpDateSpanDays(opts.startDate ?? null, opts.endDate ?? null) ?? 0;
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const likelyCrm = countLikelyCrmFallbackChunks(chunks, opts, hints);
  const crmPerChunkMs = isArcpApproveDateColumn(dateColumn) ? 25000 : 15000;
  const concurrency = likelyCrm > 1 ? resolveArcpLoadConcurrency(opts) : 1;
  const postgresReady = Boolean(hints?.usePostgres && hints.coverage && hints.coverage.rowCount > 0);
  const estimateMs = postgresReady
    ? 5000 + Math.ceil(likelyCrm / concurrency) * crmPerChunkMs
    : Math.ceil(chunks.length / concurrency) * crmPerChunkMs;

  return {
    spanDays: span,
    chunkCount: chunks.length,
    isLongLoad:
      likelyCrm > 0 ||
      (!postgresReady &&
        (chunks.length > 1 || span > ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS)),
    estimateMs,
    chunks,
    crmChunkCount: likelyCrm,
  };
}

/** Same key as tally SQL — vucnno first to match historical detail export totals. */
export function arcpDetailDedupeKey(row: ArcpClaimsDetailRow): string {
  const ucn = String(row.vucnno ?? '').trim();
  if (ucn) return `ucn:${ucn}`;
  const callNo = String(row.call_no ?? '').trim();
  if (callNo && callNo !== '0') return `call:${callNo}`;
  const fault = String(row.calls2fault_code ?? '').trim();
  const office = String(row.franchisee_code ?? '').trim();
  if (fault) return `fault:${fault}:${office}`;
  return `line:${fault}:${office}`;
}

function compareArcpDetailRowsForDedupe(a: ArcpClaimsDetailRow, b: ArcpClaimsDetailRow): number {
  const aBm = a.bm_approved_date || '';
  const bBm = b.bm_approved_date || '';
  if (aBm !== bBm) return bBm.localeCompare(aBm);
  const aCall = String(a.call_no ?? '').trim();
  const bCall = String(b.call_no ?? '').trim();
  if (aCall !== bCall) return bCall.localeCompare(aCall);
  return String(b.calls2fault_code ?? '').localeCompare(String(a.calls2fault_code ?? ''));
}

export function mergeArcpDetailRows(rows: ArcpClaimsDetailRow[]): ArcpClaimsDetailRow[] {
  const sorted = [...rows].sort(compareArcpDetailRowsForDedupe);
  const map = new Map<string, ArcpClaimsDetailRow>();
  for (const row of sorted) {
    const key = arcpDetailDedupeKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
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

/**
 * Stable merge key for tally totals across weekly CRM/Postgres chunks.
 * Excludes claim_month so the same service bucket is not duplicated when one chunk
 * returns claim_month "unknown" and another returns "2025-03" (monthly view uses raw rows).
 */
function aggregateGroupKey(
  row: ArcpClaimsAggregateRow,
  options?: { includeClaimMonth?: boolean }
): string {
  const parts = [
    String(row.ncalltype ?? ''),
    String(row.nitemcategory ?? ''),
    String(row.nlocalupcountry ?? ''),
    String(row.is_travel ?? 0),
    String(row.major_minor ?? ''),
  ];
  if (options?.includeClaimMonth) {
    parts.unshift(String(row.claim_month ?? 'unknown').trim() || 'unknown');
  }
  return parts.join('\0');
}

export function mergeArcpAggregateRows(
  rows: ArcpClaimsAggregateRow[],
  options?: { includeClaimMonth?: boolean }
): ArcpClaimsAggregateRow[] {
  const map = new Map<
    string,
    ArcpClaimsAggregateRow & { rateWeighted: number; rateQty: number }
  >();

  for (const row of rows) {
    const key = aggregateGroupKey(row, options);
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
    call_date: formatArcpClaimsExportDate(row.call_date),
    solve_date: formatArcpClaimsExportDate(row.solve_date),
    bm_approved_date: formatArcpClaimsExportDate(row.bm_approved_date),
    ho_approved_date: formatArcpClaimsExportDate(row.ho_approved_date),
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
