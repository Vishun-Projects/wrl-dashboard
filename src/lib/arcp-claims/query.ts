import {
  planArcpCoverageSegments,
  type ArcpCoverageDateColumn,
  type ArcpPostgresCoverage,
} from '@/lib/read-model/arcp/coverage-shared';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import {
  appendCallTypeFilter,
  buildTrhcallsDateRangePredicates,
  sqlTruthyCrmFlag,
} from '@/lib/trhcalls/query';

export type ArcpDateFilterColumn =
  | 'dcalllogdatetime'
  | 'dsolveddatetime'
  | 'bm_approved_at';

export const ARCP_DATE_FILTER_OPTIONS: { value: ArcpDateFilterColumn; label: string }[] = [
  { value: 'dcalllogdatetime', label: 'Call Date' },
  { value: 'dsolveddatetime', label: 'Call Solve Date' },
  { value: 'bm_approved_at', label: 'BM Call Approved' },
];

export function isArcpApproveDateColumn(
  column: string | null | undefined
): column is 'bm_approved_at' {
  return column === 'bm_approved_at';
}

/** Up to ~2 months completes in one CRM query (~4–5s). Wider spans split automatically. */
export const ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS = 62;
/** BM/HO approve: weekly CRM windows (Vercel default). Backfill uses its own 1-day env. */
export const ARCP_APPROVE_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.ARCP_APPROVE_CHUNK_DAYS ?? 7) || 7
);
/** BM/HO with branch or franchisee filter — smaller CRM windows to avoid timeouts. */
export const ARCP_APPROVE_SCOPED_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.ARCP_APPROVE_SCOPED_CHUNK_DAYS ?? 3) || 3
);
/** Call/solve date with branch or franchisee — weekly CRM windows (avoids one huge timeout). */
export const ARCP_SCOPED_CALL_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.ARCP_SCOPED_CALL_CHUNK_DAYS ?? 7) || 7
);

/** Approve-date chunk size from active filters (branch uses all franchisees under nunder). */
export function resolveArcpApproveChunkDays(opts: ArcpClaimsQueryOpts): number {
  if (opts.franchisee?.trim() || opts.branch?.trim()) {
    return ARCP_APPROVE_SCOPED_CHUNK_DAYS;
  }
  return ARCP_APPROVE_CHUNK_DAYS;
}

export function resolveArcpCallChunkDays(opts: ArcpClaimsQueryOpts): number {
  if (opts.franchisee?.trim() || opts.branch?.trim()) {
    return ARCP_SCOPED_CALL_CHUNK_DAYS;
  }
  return ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS;
}
/** Parallel CRM requests for call/solve date loads (UI + server). */
export const ARCP_LOAD_CONCURRENCY = 3;
/** Approve-date queries are heavy — run one CRM request at a time to avoid 30s SQL timeouts. */
export const ARCP_APPROVE_LOAD_CONCURRENCY = 1;
/** UI CRM fallback: skip label joins in CRM; resolve from Postgres dims after fetch. */
export const ARCP_CRM_UI_LIGHTWEIGHT = process.env.ARCP_CRM_UI_LIGHTWEIGHT !== 'false';

/** ≤31 days → one chunk per day; 32–90 → weekly; >90 → calendar month. */
export const ARCP_SPAN_DAY_CHUNK_MAX = 31;
export const ARCP_SPAN_WEEK_CHUNK_MAX = 90;
export const ARCP_WEEK_CHUNK_DAYS = 7;

export type ArcpChunkGranularity = 'single' | 'day' | 'week' | 'month';

export function resolveArcpChunkGranularity(spanDays: number): ArcpChunkGranularity {
  if (spanDays <= 1) return 'single';
  if (spanDays <= ARCP_SPAN_DAY_CHUNK_MAX) return 'day';
  if (spanDays <= ARCP_SPAN_WEEK_CHUNK_MAX) return 'week';
  return 'month';
}

export function arcpChunkPeriodLabel(
  granularity: ArcpChunkGranularity,
  plural = true
): string {
  switch (granularity) {
    case 'day':
      return plural ? 'days' : 'day';
    case 'week':
      return plural ? 'weeks' : 'week';
    case 'month':
      return plural ? 'months' : 'month';
    default:
      return plural ? 'periods' : 'period';
  }
}

export function resolveArcpLoadConcurrency(
  opts: ArcpClaimsQueryOpts,
  plan?: Pick<ArcpLoadPlan, 'chunkCount' | 'spanDays' | 'chunkGranularity'>
): number {
  const granularity = plan?.chunkGranularity;
  if (granularity === 'day' || granularity === 'week' || granularity === 'month') {
    return ARCP_LOAD_CONCURRENCY;
  }
  if (isArcpApproveDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn))) {
    return ARCP_APPROVE_LOAD_CONCURRENCY;
  }
  return ARCP_LOAD_CONCURRENCY;
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
  if (column === 'bm_approved_at') return column;
  // Legacy URL param from combined "Call Approve Date" filter
  if (column === 'approve') return 'bm_approved_at';
  // Removed HO date basis — fall back to call date
  if (column === 'ho_approved_at') return 'dcalllogdatetime';
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

type ArcpTrhcallsScopeOpts = Pick<ArcpClaimsQueryOpts, 'franchisee' | 'branch'>;

/** Scope trhcalls to selected franchisee(s) or all franchisees under branch (o.nunder). */
function appendTrhcallsOfficeScope(condition: string, opts?: ArcpTrhcallsScopeOpts): string {
  if (opts?.franchisee) {
    return appendCsvInFilter(condition, 'CAST(tc.nofficeid AS VARCHAR(50))', opts.franchisee);
  }
  if (!opts?.branch) return condition;

  let exists = `EXISTS (
    SELECT 1
    FROM mstoffice fo (NOLOCK)
    WHERE CAST(fo.ncode AS VARCHAR(50)) = CAST(tc.nofficeid AS VARCHAR(50))
      AND CAST(fo.nofficetype AS VARCHAR(10)) = '3'`;
  exists = appendCsvInFilter(exists, 'CAST(fo.nunder AS VARCHAR(50))', opts.branch);
  return `${condition} AND ${exists})`;
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

const ARCP_VUCNNO_EXPR = `NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '')`;

const TRHCALLS_DT_103 = (column: string) =>
  `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(${column} AS VARCHAR(30)))), ''), 103)`;

/** Link ARCP line to trhcalls: vucnno = vtrnno, else fault ncalls = tc.ncode. */
function buildArcpTrhcallsLinkSql(tcAlias = 'tc'): string {
  const vtrnno = `NULLIF(LTRIM(RTRIM(CAST(${tcAlias}.vtrnno AS VARCHAR(50)))), '')`;
  return `(
    (${ARCP_VUCNNO_EXPR} IS NOT NULL AND ${ARCP_VUCNNO_EXPR} = ${vtrnno})
    OR (
      ${ARCP_VUCNNO_EXPR} IS NULL
      AND EXISTS (
        SELECT 1 FROM trdcalls2fault tf_dt (NOLOCK)
        WHERE tf_dt.ncode = arcp.ncalls2fault
          AND CAST(tf_dt.ncalls AS VARCHAR(50)) = CAST(${tcAlias}.ncode AS VARCHAR(50))
      )
    )
  )`;
}

function buildArcpTrhcallsRowPredicates(
  dateColumn: ArcpDateFilterColumn,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  tcAlias = 'tc'
): string[] {
  const parts: string[] = [];

  if (dateColumn === 'bm_approved_at') {
    parts.push(sqlTruthyCrmFlag(`${tcAlias}.bapproval`));
    parts.push(
      ...buildTrhcallsDateRangePredicates({
        startDate,
        endDate,
        column: `${tcAlias}.editedon`,
      })
    );
  } else if (dateColumn === 'dsolveddatetime') {
    parts.push(sqlTruthyCrmFlag(`${tcAlias}.bsolved`));
    parts.push(
      ...buildTrhcallsDateRangePredicates({
        startDate,
        endDate,
        column: `${tcAlias}.dsolvedatetime`,
      })
    );
  } else {
    parts.push(
      ...buildTrhcallsDateRangePredicates({
        startDate,
        endDate,
        column: `${tcAlias}.dtrndate`,
      })
    );
  }

  return parts;
}

/** Call/solve/BM: pre-filter trhcalls by date, match ARCP by vucnno = vtrnno. */
function buildArcpMatchingTrhcallsVtrnnoSubquery(
  dateColumn: ArcpDateFilterColumn,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  opts?: ArcpTrhcallsScopeOpts
): string {
  const parts = [
    `NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') IS NOT NULL`,
    ...buildArcpTrhcallsRowPredicates(dateColumn, startDate, endDate, 'tc'),
  ];
  let where = parts.join(' AND ');
  where = appendTrhcallsOfficeScope(where, opts);

  return `
    SELECT DISTINCT NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') AS vtrnno
    FROM trhcalls tc (NOLOCK)
    WHERE ${where}`.trim();
}

function buildArcpTrhcallsDateExistsInner(
  dateColumn: ArcpDateFilterColumn,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  opts?: ArcpTrhcallsScopeOpts,
  tcAlias = 'tc'
): string {
  const parts = [
    buildArcpTrhcallsLinkSql(tcAlias),
    ...buildArcpTrhcallsRowPredicates(dateColumn, startDate, endDate, tcAlias),
  ];
  return appendTrhcallsOfficeScope(parts.join(' AND '), opts);
}

function appendArcpDateFilter(
  condition: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  dateColumn: ArcpDateFilterColumn,
  opts?: ArcpTrhcallsScopeOpts
): string {
  const hasDateRange = Boolean(startDate || endDate);
  if (dateColumn !== 'bm_approved_at' && !hasDateRange) {
    return condition;
  }

  const vtrnnoSubquery = buildArcpMatchingTrhcallsVtrnnoSubquery(
    dateColumn,
    startDate,
    endDate,
    opts
  );

  if (dateColumn === 'bm_approved_at') {
    const vtrnno = `NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')`;
    const tcWhere = appendTrhcallsOfficeScope(
      [
        `${ARCP_VUCNNO_EXPR} IS NOT NULL`,
        `${ARCP_VUCNNO_EXPR} = ${vtrnno}`,
        ...buildArcpTrhcallsRowPredicates('bm_approved_at', startDate, endDate, 'tc'),
      ].join(' AND '),
      opts
    );
    return `${condition} AND EXISTS (
      SELECT 1
      FROM trhcalls tc (NOLOCK)
      WHERE ${tcWhere}
    )`;
  }

  const fallbackExists = `EXISTS (
    SELECT 1
    FROM trdcalls2fault tf_dt (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON CAST(tf_dt.ncalls AS VARCHAR(50)) = CAST(tc.ncode AS VARCHAR(50))
    WHERE tf_dt.ncode = arcp.ncalls2fault
      AND ${buildArcpTrhcallsDateExistsInner(dateColumn, startDate, endDate, opts, 'tc')}
  )`;

  return `${condition} AND (
    (${ARCP_VUCNNO_EXPR} IS NOT NULL AND ${ARCP_VUCNNO_EXPR} IN (${vtrnnoSubquery}))
    OR (${ARCP_VUCNNO_EXPR} IS NULL AND ${fallbackExists})
  )`;
}

function buildArcpTrhcallsDateApply(
  dateColumn: ArcpDateFilterColumn,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  opts?: ArcpTrhcallsScopeOpts
): string {
  if (dateColumn === 'bm_approved_at') {
    const vtrnno = `NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')`;
    const where = appendTrhcallsOfficeScope(
      [
        `${ARCP_VUCNNO_EXPR} IS NOT NULL`,
        `${ARCP_VUCNNO_EXPR} = ${vtrnno}`,
        ...buildArcpTrhcallsRowPredicates('bm_approved_at', startDate, endDate, 'tc'),
      ].join(' AND '),
      opts
    );
    return `
OUTER APPLY (
  SELECT TOP 1
    ${TRHCALLS_DT_103('tc.dtrndate')} AS call_dt,
    ${TRHCALLS_DT_103('tc.dsolvedatetime')} AS solve_dt,
    ${TRHCALLS_DT_103('tc.editedon')} AS bm_dt
  FROM trhcalls tc (NOLOCK)
  WHERE ${where}
  ORDER BY tc.editedon DESC, CAST(tc.ncode AS VARCHAR(50)) DESC
) tc_dt`;
  }

  return `
OUTER APPLY (
  SELECT TOP 1
    ${TRHCALLS_DT_103('tc.dtrndate')} AS call_dt,
    ${TRHCALLS_DT_103('tc.dsolvedatetime')} AS solve_dt,
    ${TRHCALLS_DT_103('tc.editedon')} AS bm_dt
  FROM trhcalls tc (NOLOCK)
  WHERE ${buildArcpTrhcallsLinkSql('tc')}
  ORDER BY ISNULL(tc.editedon, tc.addedon) DESC, CAST(tc.ncode AS VARCHAR(50)) DESC
) tc_dt`;
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

function buildArcpClaimMonthExpr(dateColumn: ArcpDateFilterColumn): string {
  const dateExpr =
    dateColumn === 'bm_approved_at'
      ? 'tc_dt.bm_dt'
      : dateColumn === 'dsolveddatetime'
        ? 'tc_dt.solve_dt'
        : 'tc_dt.call_dt';

  return `ISNULL(FORMAT(${dateExpr}, 'yyyy-MM'), 'unknown')`;
}

function buildArcpClaimsFilterParts(opts: ArcpClaimsQueryOpts): {
  condition: string;
} {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  let condition = "arcp.nofficetype = '3'";

  condition = appendArcpDateFilter(condition, opts.startDate, opts.endDate, dateColumn, opts);

  condition = appendCsvInFilter(condition, 'o.nunder', opts.branch);
  condition = appendCsvInFilter(condition, 'arcp.nofficeid', opts.franchisee);
  condition = appendCallTypeFilter(condition, opts.callType, 'arcp.ncalltype');
  condition = appendArcpOfficeSecurityFilter(condition, opts.isHod ?? true, opts.assignedOffices ?? []);

  if (opts.ncodeShard && opts.ncodeShard.count > 0) {
    condition += ` AND (arcp.ncode % ${opts.ncodeShard.count}) = ${opts.ncodeShard.index}`;
  }

  return { condition };
}

/** CRM WHERE clause for trdcalls10ARCP (franchisee type 3), including date/branch filters. */
export function buildArcpClaimsFilterCondition(opts: ArcpClaimsQueryOpts): string {
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
  if (dateColumn === 'bm_approved_at') return 'tc_dt.bm_dt';
  if (dateColumn === 'dsolveddatetime') return 'tc_dt.solve_dt';
  return 'tc_dt.call_dt';
}

/** One row per ARCP line — nested subquery (CRM rawSql cannot use WITH / CTE). */
function buildArcpClaimsLinesSubquery(
  condition: string,
  claimMonthExpr: string,
  isTravelExpr: string,
  lightweight = false,
  dateColumn: ArcpDateFilterColumn = 'dcalllogdatetime',
  trhcallsDateApply: string = buildArcpTrhcallsDateApply('dcalllogdatetime', null, null)
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

  const sumAllApproved = arcpTallySumsApprovedOnAllFilteredLines(dateColumn);
  const groupByClause = sumAllApproved
    ? 'arcp.ncode'
    : `arcp.ncode,
    ${claimMonthExpr},
    arcp.ncalltype,
    arcp.nitemcategory,
    arcp.nlocalupcountry,
    ${isTravelExpr},
    ${MAJOR_MINOR_EXPR}`;

  return `
  SELECT
    arcp.ncode,
    ${sumAllApproved ? `MAX(${claimMonthExpr})` : claimMonthExpr} AS claim_month,
    ${sumAllApproved ? 'MAX(arcp.ncalltype)' : 'arcp.ncalltype'} AS ncalltype,
    ${sumAllApproved ? 'MAX(arcp.nitemcategory)' : 'arcp.nitemcategory'} AS nitemcategory,
    ${sumAllApproved ? 'MAX(arcp.nlocalupcountry)' : 'arcp.nlocalupcountry'} AS nlocalupcountry,
    ${sumAllApproved ? `MAX(${isTravelExpr})` : isTravelExpr} AS is_travel,
    ${sumAllApproved ? `MAX(${MAJOR_MINOR_EXPR})` : MAJOR_MINOR_EXPR} AS major_minor,
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
  ${trhcallsDateApply}
  ${labelApplies}
  WHERE ${condition}
    ${ARCP_NOT_REJECTED}
    ${ARCP_INCLUDED_LINES_FILTER_EXISTS}
  GROUP BY
    ${groupByClause}
  `.trim();
}

function useCrmUiLightweightSql(opts: ArcpClaimsQueryOpts): boolean {
  return Boolean(opts.crmUiFast && ARCP_CRM_UI_LIGHTWEIGHT);
}

/**
 * BM Call Approved: date comes from trhcalls (bapproval + editedon) → vucnno = vtrnno.
 * Sum branch/HO on every matching ARCP line (live CRM verification ~₹26,230 for FR152 Apr 2026).
 */
function arcpTallySumsApprovedOnAllFilteredLines(dateColumn: ArcpDateFilterColumn): boolean {
  return dateColumn === 'bm_approved_at';
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

/** Qty and amount payable from every line; branch/HO from all lines (BM) or winning-lines union. */
function buildArcpClaimsLineBucketSubquery(
  linesSubquery: string,
  sumApprovedOnAllLines = false
): string {
  const branchExpr = sumApprovedOnAllLines
    ? 'SUM(al.branch_approved)'
    : 'CAST(0 AS FLOAT)';
  const hoExpr = sumApprovedOnAllLines ? 'SUM(al.ho_approved)' : 'CAST(0 AS FLOAT)';
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
  ${branchExpr} AS branch_approved,
  ${hoExpr} AS ho_approved,
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
  const trhcallsDateApply = buildArcpTrhcallsDateApply(
    dateColumn,
    opts.startDate,
    opts.endDate,
    opts
  );
  const sumAllApproved = arcpTallySumsApprovedOnAllFilteredLines(dateColumn);
  const linesSubquery = buildArcpClaimsLinesSubquery(
    condition,
    claimMonthExpr,
    isTravelExpr,
    useCrmUiLightweightSql(opts) || sumAllApproved,
    dateColumn,
    trhcallsDateApply
  );
  const lineBucketSubquery = buildArcpClaimsLineBucketSubquery(
    linesSubquery,
    sumAllApproved
  );

  if (sumAllApproved) {
    return `
SELECT
  lb.claim_month,
  lb.ncalltype,
  MAX(lb.call_type_label) AS call_type_label,
  lb.nitemcategory,
  MAX(lb.item_category_label) AS item_category_label,
  lb.nlocalupcountry,
  MAX(lb.local_upcountry_label) AS local_upcountry_label,
  lb.is_travel,
  lb.major_minor,
  AVG(NULLIF(lb.rate_val, 0)) AS rate,
  SUM(lb.line_qty) AS qty,
  SUM(lb.amount_payable) AS amount_payable,
  SUM(lb.branch_approved) AS branch_approved,
  SUM(lb.ho_approved) AS ho_approved
FROM (
${lineBucketSubquery}
) lb
GROUP BY
  lb.claim_month,
  lb.ncalltype,
  lb.nitemcategory,
  lb.nlocalupcountry,
  lb.is_travel,
  lb.major_minor
`.trim();
  }

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
  /** CRM trdcalls10ARCP.ncode — one export row per line (service + travel both kept). */
  ncode: string;
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
  const trhcallsDateApply = buildArcpTrhcallsDateApply(
    dateColumn,
    opts.startDate,
    opts.endDate,
    opts
  );
  const sumAllApproved = arcpTallySumsApprovedOnAllFilteredLines(dateColumn);
  const linesSubquery = buildArcpClaimsLinesSubquery(
    condition,
    claimMonthExpr,
    isTravelExpr,
    useCrmUiLightweightSql(opts) || sumAllApproved,
    dateColumn,
    trhcallsDateApply
  );
  const winningLinesSubquery = sumAllApproved
    ? ''
    : buildArcpClaimsWinningLinesSubquery(linesSubquery);
  const approvedFromLines = sumAllApproved
    ? `(SELECT SUM(al.branch_approved) FROM (\n${linesSubquery}\n  ) al)`
    : `(SELECT SUM(wl.branch_approved) FROM (\n${winningLinesSubquery}\n  ) wl)`;
  const hoFromLines = sumAllApproved
    ? `(SELECT SUM(al.ho_approved) FROM (\n${linesSubquery}\n  ) al)`
    : `(SELECT SUM(wl.ho_approved) FROM (\n${winningLinesSubquery}\n  ) wl)`;

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
  ${approvedFromLines} AS branch_approved,
  ${hoFromLines} AS ho_approved
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
  deduped.ncode,
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

/**
 * Pick query windows from span only (same for call/solve/BM):
 * ≤31 days → daily; 32–90 → weekly; >90 → calendar month.
 */
export function planArcpSummaryDateChunks(opts: ArcpClaimsQueryOpts): { start: string; end: string }[] {
  if (!opts.startDate || !opts.endDate) {
    return [{ start: opts.startDate || '', end: opts.endDate || '' }];
  }

  const span = arcpDateSpanDays(opts.startDate, opts.endDate);
  if (span == null || span <= 0) {
    return [{ start: opts.startDate, end: opts.endDate }];
  }

  const granularity = resolveArcpChunkGranularity(span);
  switch (granularity) {
    case 'single':
      return [{ start: opts.startDate, end: opts.endDate }];
    case 'day':
      return splitArcpDateRange(opts.startDate, opts.endDate, 1);
    case 'week':
      return splitArcpDateRange(opts.startDate, opts.endDate, ARCP_WEEK_CHUNK_DAYS);
    case 'month':
      return splitArcpDateRangeByMonth(opts.startDate, opts.endDate);
  }
}

export type ArcpLoadPlan = {
  spanDays: number;
  chunkCount: number;
  chunkGranularity: ArcpChunkGranularity;
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
  const chunkGranularity = resolveArcpChunkGranularity(span);
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const likelyCrm = countLikelyCrmFallbackChunks(chunks, opts, hints);
  const crmPerChunkMs = isArcpApproveDateColumn(dateColumn) ? 28000 : 12000;
  const postgresReady = Boolean(hints?.usePostgres && hints.coverage && hints.coverage.rowCount > 0);
  const perChunkMs = postgresReady
    ? chunkGranularity === 'day'
      ? 800
      : chunkGranularity === 'week'
        ? 2000
        : chunkGranularity === 'month'
          ? 5000
          : 3000
    : crmPerChunkMs;
  const concurrency =
    chunks.length > 1
      ? resolveArcpLoadConcurrency(opts, { chunkCount: chunks.length, spanDays: span, chunkGranularity })
      : 1;
  const clientChunked = chunks.length > 1;
  const estimateMs = clientChunked
    ? Math.ceil(chunks.length / concurrency) * perChunkMs
    : postgresReady
      ? 3000 + Math.ceil(likelyCrm / concurrency) * crmPerChunkMs
      : Math.ceil(chunks.length / concurrency) * perChunkMs;

  return {
    spanDays: span,
    chunkCount: chunks.length,
    chunkGranularity,
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
 * Multi-chunk UI loads (weekly BM windows, monthly call/solve) keep each CRM request small.
 * Date basis uses live trhcalls — do not collapse to one HTTP call when the plan has multiple chunks.
 */
export function shouldUseClientSideArcpChunks(
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): boolean {
  const plan = estimateArcpLoadPlan(opts, hints);
  if (plan.chunkCount > 1) return true;
  /** One server round-trip until coverage is known. */
  if (hints?.usePostgres && !hints.coverage) {
    return false;
  }
  if (hints?.usePostgres && hints.coverage && hints.coverage.rowCount > 0) {
    return false;
  }
  return false;
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
    chunkGranularity: 'single',
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
  const chunkGranularity = resolveArcpChunkGranularity(span);
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const likelyCrm = countLikelyCrmFallbackChunks(chunks, opts, hints);
  const crmPerChunkMs = isArcpApproveDateColumn(dateColumn) ? 28000 : 15000;
  const postgresReady = Boolean(hints?.usePostgres && hints.coverage && hints.coverage.rowCount > 0);
  const perChunkMs = postgresReady
    ? chunkGranularity === 'day'
      ? 1500
      : chunkGranularity === 'week'
        ? 4000
        : chunkGranularity === 'month'
          ? 8000
          : 5000
    : crmPerChunkMs;
  const concurrency =
    chunks.length > 1
      ? resolveArcpLoadConcurrency(opts, { chunkCount: chunks.length, spanDays: span, chunkGranularity })
      : 1;
  const estimateMs = postgresReady
    ? 5000 + Math.ceil(likelyCrm / concurrency) * crmPerChunkMs
    : Math.ceil(chunks.length / concurrency) * perChunkMs;

  return {
    spanDays: span,
    chunkCount: chunks.length,
    chunkGranularity,
    isLongLoad:
      likelyCrm > 0 ||
      (!postgresReady &&
        (chunks.length > 1 || span > ARCP_SUMMARY_SINGLE_QUERY_MAX_DAYS)),
    estimateMs,
    chunks,
    crmChunkCount: likelyCrm,
  };
}

/** Detail export: one round-trip when tally does (same filters/date range). */
export function resolveArcpClientDetailLoadPlan(
  opts: ArcpClaimsQueryOpts,
  hints?: ArcpLoadEstimateHints
): ArcpLoadPlan {
  const plan = estimateArcpDetailLoadPlan(opts, hints);
  if (shouldUseClientSideArcpChunks(opts, hints)) return plan;
  const start = opts.startDate ?? '';
  const end = opts.endDate ?? '';
  const scoped =
    Boolean(opts.franchisee?.trim()) ||
    Boolean(opts.branch?.trim()) ||
    (opts.callType && opts.callType !== 'All');
  return {
    ...plan,
    chunkCount: 1,
    chunkGranularity: 'single',
    isLongLoad: false,
    estimateMs: scoped ? 8000 : Math.min(plan.estimateMs, 180_000),
    chunks: [{ start, end }],
    crmChunkCount: plan.crmChunkCount,
  };
}

/** One row per ARCP line — matches tally qty (COUNT DISTINCT ncode). */
export function arcpDetailLineKey(row: ArcpClaimsDetailRow): string {
  const code = String(row.ncode ?? '').trim();
  if (code) return `ncode:${code}`;
  return [
    'line',
    row.vucnno,
    row.line_type,
    row.calls2fault_code,
    row.franchisee_code,
    row.item_category,
    row.amount_payable,
  ].join(':');
}

/** Claim key — same as tally SQL ARCP_CALL_KEY / winning-line PARTITION BY. */
export function arcpDetailCallKey(row: ArcpClaimsDetailRow): string {
  const ucn = String(row.vucnno ?? '').trim();
  if (ucn) return ucn;
  const callNo = String(row.call_no ?? '').trim();
  if (callNo && callNo !== '0') return callNo;
  const fault = String(row.calls2fault_code ?? '').trim();
  const office = String(row.franchisee_code ?? '').trim();
  if (fault) return `${fault}:${office}`;
  return `line:${fault}:${office}`;
}

/** One row per claim UCN — SAP branch-total scripts only; do not use for detail CSV. */
export function arcpDetailDedupeKey(row: ArcpClaimsDetailRow): string {
  const key = arcpDetailCallKey(row);
  if (key.startsWith('line:')) return key;
  if (String(row.vucnno ?? '').trim()) return `ucn:${key}`;
  if (String(row.call_no ?? '').trim() && row.call_no !== '0') return `call:${key}`;
  return `fault:${key}`;
}

function compareArcpDetailRowsForWinning(a: ArcpClaimsDetailRow, b: ArcpClaimsDetailRow): number {
  const aHo = a.ho_approved_date || '';
  const bHo = b.ho_approved_date || '';
  if (aHo !== bHo) return bHo.localeCompare(aHo);
  const aBm = a.bm_approved_date || '';
  const bBm = b.bm_approved_date || '';
  if (aBm !== bBm) return bBm.localeCompare(aBm);
  return String(b.ncode ?? '').localeCompare(String(a.ncode ?? ''));
}

/**
 * Detail CSV: keep every ARCP line, but Branch/HO only on the winning line per claim
 * (same rule as the on-screen tally). Raw BM/HO columns stay per-line from CRM.
 */
export function applyArcpDetailExportApprovedAmounts(
  rows: ArcpClaimsDetailRow[],
  dateFilterColumn?: ArcpDateFilterColumn | null
): ArcpClaimsDetailRow[] {
  if (arcpTallySumsApprovedOnAllFilteredLines(resolveArcpDateFilterColumn(dateFilterColumn))) {
    return rows;
  }

  const groups = new Map<string, ArcpClaimsDetailRow[]>();
  for (const row of rows) {
    const key = arcpDetailCallKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const winningLineKeys = new Set<string>();
  for (const group of groups.values()) {
    const winner = [...group].sort(compareArcpDetailRowsForWinning)[0];
    if (winner) winningLineKeys.add(arcpDetailLineKey(winner));
  }

  return rows.map((row) => {
    if (winningLineKeys.has(arcpDetailLineKey(row))) return row;
    return {
      ...row,
      branch_approved: 0,
      ho_approved: 0,
      payable_minus_branch: row.amount_payable,
      payable_minus_ho: row.amount_payable,
    };
  });
}

/** Dedupe chunk/overlap duplicates only — keeps every service + travel line. */
export function mergeArcpDetailRows(rows: ArcpClaimsDetailRow[]): ArcpClaimsDetailRow[] {
  const map = new Map<string, ArcpClaimsDetailRow>();
  for (const row of rows) {
    const key = arcpDetailLineKey(row);
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

/** Preserve claim_month when merging rows from different date-range chunks (multi-month loads). */
export const ARCP_MERGE_ACROSS_CHUNKS = { includeClaimMonth: true } as const;

/** yyyy-MM labels for calendar months touched by a chunk date range. */
export function claimMonthsForArcpChunk(start: string, end: string): string[] {
  return splitArcpDateRangeByMonth(start, end).map((chunk) => chunk.start.slice(0, 7));
}

/**
 * Merge one fetched chunk into running aggregates.
 * When replaceMonths is true (calendar-month plans), drop prior rows for those months first
 * so server partialAggregates + client refetch cannot double-count.
 */
export function mergeArcpChunkAggregateRows(
  running: ArcpClaimsAggregateRow[],
  chunk: { start: string; end: string },
  chunkRows: ArcpClaimsAggregateRow[],
  options?: { replaceMonths?: boolean }
): ArcpClaimsAggregateRow[] {
  if (chunkRows.length === 0) return running;
  const monthsToReplace = options?.replaceMonths ? new Set(claimMonthsForArcpChunk(chunk.start, chunk.end)) : null;
  const base =
    monthsToReplace && monthsToReplace.size > 0
      ? running.filter((row) => {
          const month = String(row.claim_month ?? 'unknown').trim() || 'unknown';
          return !monthsToReplace.has(month);
        })
      : running;
  return mergeArcpAggregateRows([...base, ...chunkRows], ARCP_MERGE_ACROSS_CHUNKS);
}

/**
 * Stable merge key for tally totals across CRM/Postgres chunks.
 * Excludes claim_month for the service summary so one bucket is not duplicated when
 * chunks disagree on month label; monthly breakdown keeps month via ARCP_MERGE_ACROSS_CHUNKS.
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
    ncode: String(row.ncode ?? ''),
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
