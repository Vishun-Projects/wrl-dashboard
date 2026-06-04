import { withClient } from '@/lib/read-model/db';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { arcpLinesHotHasCallNo } from '@/lib/read-model/arcp/hot-schema';
import { ARCP_REPORT_TIMEZONE } from '@/lib/read-model/arcp/dates';
import {
  LOCAL_UPCOUNTRY_NCODE_LABELS,
  isArcpApproveDateColumn,
  parseArcpAggregateRows,
  parseArcpGrandTotals,
  resolveArcpDateFilterColumn,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpClaimsQueryOpts,
  type ArcpDateFilterColumn,
  type ArcpGrandTotals,
} from '../query';

type DateCols = {
  tsCol: string;
  monthCol: string;
};

function calendarDateExpr(tsCol: string): string {
  return `(${tsCol} AT TIME ZONE '${ARCP_REPORT_TIMEZONE}')::date`;
}

function claimMonthExpr(tsCol: string): string {
  return `to_char(${calendarDateExpr(tsCol)}, 'YYYY-MM')`;
}

function colRef(column: string, alias?: string): string {
  return alias ? `${alias}.${column}` : column;
}

function resolveHotSortColumn(dateColumn: ArcpDateFilterColumn, alias = 'h'): string {
  if (dateColumn === 'bm_approved_at') return colRef('bm_approved_at', alias);
  if (dateColumn === 'dsolveddatetime') return colRef('solve_at', alias);
  return colRef('call_at', alias);
}

function resolveDateCols(dateColumn: ArcpDateFilterColumn, alias?: string): DateCols {
  if (dateColumn === 'bm_approved_at') {
    const tsCol = colRef('bm_approved_at', alias);
    return { tsCol, monthCol: claimMonthExpr(tsCol) };
  }
  if (dateColumn === 'dsolveddatetime') {
    return {
      tsCol: colRef('solve_at', alias),
      monthCol: colRef('claim_month_solve', alias),
    };
  }
  return {
    tsCol: colRef('call_at', alias),
    monthCol: colRef('claim_month_call', alias),
  };
}

/** Matches arcpDetailDedupeKey — vucnno first (same as detail export). */
async function arcpHotCallKeyExpr(alias = 'h'): Promise<string> {
  const hasCallNo = await arcpLinesHotHasCallNo();
  const callNoPart = hasCallNo
    ? `NULLIF(TRIM(${alias}.call_no), ''),\n  `
    : '';
  return `COALESCE(
  NULLIF(TRIM(${alias}.vucnno), ''),
  ${callNoPart}NULLIF(TRIM(CAST(${alias}.calls2fault_code AS TEXT)), '') || ':' || CAST(${alias}.nofficeid AS TEXT)
)`;
}

function parseCsvIds(param: string | null | undefined): string[] | null {
  if (!param || param === 'All' || param === 'undefined' || param === 'null') return null;
  const values = param
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

function buildArcpWhere(
  opts: ArcpClaimsQueryOpts,
  dateColumn: ArcpDateFilterColumn,
  alias?: string
): { sql: string; params: unknown[] } {
  const { tsCol } = resolveDateCols(dateColumn, alias);
  const parts: string[] = [`${colRef('is_rejected', alias)} = false`];
  const params: unknown[] = [];
  let idx = 1;

  if (isArcpApproveDateColumn(dateColumn)) {
    parts.push(`${tsCol} IS NOT NULL`);
  }

  const dateCol = calendarDateExpr(tsCol);
  if (opts.startDate) {
    parts.push(`${dateCol} >= $${idx}::date`);
    params.push(opts.startDate);
    idx += 1;
  }
  if (opts.endDate) {
    parts.push(`${dateCol} <= $${idx}::date`);
    params.push(opts.endDate);
    idx += 1;
  }

  const branches = parseCsvIds(opts.branch);
  if (branches) {
    parts.push(`${colRef('office_under', alias)} = ANY($${idx}::bigint[])`);
    params.push(branches.map((b) => Number(b)));
    idx += 1;
  }

  const franchisees = parseCsvIds(opts.franchisee);
  if (franchisees) {
    parts.push(`${colRef('nofficeid', alias)} = ANY($${idx}::bigint[])`);
    params.push(franchisees.map((f) => Number(f)));
    idx += 1;
  }

  const callTypes = parseCsvIds(opts.callType);
  if (callTypes) {
    parts.push(`${colRef('call_type_label', alias)} = ANY($${idx}::text[])`);
    params.push(callTypes);
    idx += 1;
  }

  const isHod = opts.isHod ?? true;
  const assigned = opts.assignedOffices ?? [];
  if (!isHod && assigned.length > 0) {
    const ids = assigned.map((o) => Number(o)).filter((n) => Number.isFinite(n));
    parts.push(
      `(${colRef('nofficeid', alias)} = ANY($${idx}::bigint[]) OR ${colRef('office_under', alias)} = ANY($${idx}::bigint[]))`
    );
    params.push(ids);
    idx += 1;
  }

  return { sql: parts.join(' AND '), params };
}

function isBareNumericLabel(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

async function loadItemCategoryLabelMap(
  client: import('pg').PoolClient
): Promise<Record<string, string>> {
  const result = await client.query(`
    SELECT DISTINCT nitemcategory, item_category_label
    FROM arcp_lines_hot
    WHERE item_category_label IS NOT NULL
      AND TRIM(item_category_label) <> ''
  `);
  const map: Record<string, string> = {};
  for (const row of result.rows) {
    const code = String(row.nitemcategory ?? '').trim();
    const label = String(row.item_category_label ?? '').trim();
    if (!code || !label || isBareNumericLabel(label)) continue;
    if (!map[code] || label.length > map[code].length) map[code] = label;
  }
  return map;
}

function enrichAggregateLabels(
  rows: ArcpClaimsAggregateRow[],
  itemCategoryLabels: Record<string, string>
): ArcpClaimsAggregateRow[] {
  return rows.map((row) => {
    const code = String(row.nitemcategory ?? '').trim();
    const label = String(row.item_category_label ?? '').trim();
    if (!code || (label && !isBareNumericLabel(label))) return row;
    const resolved = itemCategoryLabels[code];
    if (!resolved) return row;
    return { ...row, item_category_label: resolved };
  });
}

export async function queryArcpClaimsAggregates(
  opts: ArcpClaimsQueryOpts
): Promise<ArcpClaimsAggregateRow[]> {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const tableAlias = 'h';
  const { monthCol } = resolveDateCols(dateColumn, tableAlias);
  const { sql: whereSql, params } = buildArcpWhere(opts, dateColumn, tableAlias);
  const callKey = await arcpHotCallKeyExpr(tableAlias);

  const sortCol = resolveHotSortColumn(dateColumn);

  const query = `
WITH hot AS (
  SELECT
    h.ncode,
    ${monthCol} AS claim_month,
    h.ncalltype,
    COALESCE(
      NULLIF(TRIM(h.call_type_label), ''),
      ct.display_value,
      NULLIF(TRIM(h.ncalltype), '')
    ) AS call_type_label,
    h.nitemcategory,
    COALESCE(
      NULLIF(TRIM(h.item_category_label), ''),
      NULLIF(TRIM(h.nitemcategory), '')
    ) AS item_category_label,
    h.nlocalupcountry,
    COALESCE(
      NULLIF(TRIM(h.local_upcountry_label), ''),
      NULLIF(TRIM(h.nlocalupcountry), '')
    ) AS local_upcountry_label,
    CASE WHEN h.is_travel THEN 1 ELSE 0 END AS is_travel,
    CASE WHEN h.is_major THEN 'Major' ELSE 'Minor' END AS major_minor,
    ${callKey} AS call_key,
    h.rate,
    h.amount_payable,
    h.branch_approved,
    h.ho_approved,
    ${sortCol} AS sort_ts
  FROM arcp_lines_hot h
  LEFT JOIN dim_call_types ct
    ON ct.ncode::text = NULLIF(TRIM(h.ncalltype), '')
  WHERE ${whereSql}
),
winning AS (
  SELECT *
  FROM (
    SELECT
      hot.*,
      ROW_NUMBER() OVER (
        PARTITION BY hot.call_key
        ORDER BY hot.sort_ts DESC NULLS LAST, hot.ncode DESC
      ) AS rn
    FROM hot
  ) ranked
  WHERE ranked.rn = 1
),
combined AS (
  SELECT
    claim_month,
    ncalltype,
    call_type_label,
    nitemcategory,
    item_category_label,
    nlocalupcountry,
    local_upcountry_label,
    is_travel,
    major_minor,
    COUNT(DISTINCT ncode)::int AS line_qty,
    SUM(amount_payable) AS amount_payable,
    0::float8 AS branch_approved,
    0::float8 AS ho_approved,
    AVG(NULLIF(rate, 0)) AS rate_val
  FROM hot
  GROUP BY
    claim_month,
    ncalltype,
    call_type_label,
    nitemcategory,
    item_category_label,
    nlocalupcountry,
    local_upcountry_label,
    is_travel,
    major_minor
  UNION ALL
  SELECT
    claim_month,
    ncalltype,
    call_type_label,
    nitemcategory,
    item_category_label,
    nlocalupcountry,
    local_upcountry_label,
    is_travel,
    major_minor,
    0,
    0,
    branch_approved,
    ho_approved,
    NULL::float8
  FROM winning
)
SELECT
  claim_month,
  ncalltype,
  MAX(call_type_label) AS call_type_label,
  nitemcategory,
  MAX(item_category_label) AS item_category_label,
  nlocalupcountry,
  MAX(local_upcountry_label) AS local_upcountry_label,
  is_travel,
  major_minor,
  AVG(NULLIF(rate_val, 0)) AS rate,
  SUM(line_qty)::int AS qty,
  SUM(amount_payable) AS amount_payable,
  SUM(branch_approved) AS branch_approved,
  SUM(ho_approved) AS ho_approved
FROM combined
GROUP BY
  claim_month,
  ncalltype,
  nitemcategory,
  nlocalupcountry,
  is_travel,
  major_minor
`;

  return withClient(async (client) => {
    const result = await client.query(query, params);
    const rows = parseArcpAggregateRows(result.rows as Record<string, unknown>[]);
    const itemLabels = await loadItemCategoryLabelMap(client);
    return enrichAggregateLabels(rows, itemLabels);
  });
}

export async function queryArcpClaimsGrandTotals(
  opts: ArcpClaimsQueryOpts
): Promise<ArcpGrandTotals> {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const sortCol = resolveHotSortColumn(dateColumn);
  const { sql: whereSql, params } = buildArcpWhere(opts, dateColumn, 'h');
  const callKey = await arcpHotCallKeyExpr('h');

  const query = `
WITH hot AS (
  SELECT
    h.ncode,
    h.is_travel,
    h.amount_payable,
    h.branch_approved,
    h.ho_approved,
    ${callKey} AS call_key,
    ${sortCol} AS sort_ts
  FROM arcp_lines_hot h
  WHERE ${whereSql}
),
winning AS (
  SELECT branch_approved, ho_approved
  FROM (
    SELECT
      hot.branch_approved,
      hot.ho_approved,
      ROW_NUMBER() OVER (
        PARTITION BY hot.call_key
        ORDER BY hot.sort_ts DESC NULLS LAST, hot.ncode DESC
      ) AS rn
    FROM hot
  ) ranked
  WHERE ranked.rn = 1
)
SELECT
  (SELECT COUNT(DISTINCT ncode)::int FROM hot) AS line_count,
  (SELECT COUNT(DISTINCT ncode) FILTER (WHERE is_travel)::int FROM hot) AS travel_line_count,
  (SELECT COALESCE(SUM(amount_payable), 0)::float8 FROM hot) AS amount_payable,
  (SELECT COALESCE(SUM(branch_approved), 0)::float8 FROM winning) AS branch_approved,
  (SELECT COALESCE(SUM(ho_approved), 0)::float8 FROM winning) AS ho_approved
`;

  return withClient(async (client) => {
    const result = await client.query(query, params);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return parseArcpGrandTotals(row);
  });
}

function resolveDetailOrderCol(dateColumn: ArcpDateFilterColumn): string {
  if (dateColumn === 'bm_approved_at') return 'bm_approved_at';
  if (dateColumn === 'dsolveddatetime') return 'solve_at';
  return 'call_at';
}

export async function queryArcpClaimsDetailRows(
  opts: ArcpClaimsQueryOpts
): Promise<ArcpClaimsDetailRow[]> {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const { sql: whereSql, params } = buildArcpWhere(opts, dateColumn, 'h');
  const orderCol = resolveDetailOrderCol(dateColumn);
  const hasCallNo = await arcpLinesHotHasCallNo();
  const callNoSelect = hasCallNo ? 'h.call_no,' : '';

  const query = `
SELECT
  h.ncode,
  h.vucnno,
  ${callNoSelect}
  h.calls2fault_code,
  COALESCE(fr.vcompanyname, CAST(h.nofficeid AS text)) AS franchisee_name,
  COALESCE(br.vcompanyname, CAST(h.office_under AS text)) AS branch_name,
  h.nofficeid AS franchisee_code,
  h.call_at,
  h.solve_at,
  h.bm_approved_at,
  h.ho_approved_at,
  h.approve_at,
  h.ncalltype,
  h.call_type_label,
  h.nitemcategory,
  h.item_category_label,
  h.local_upcountry_label,
  CASE WHEN h.is_major THEN 'Major' ELSE 'Minor' END AS major_minor,
  CASE WHEN h.is_travel THEN 1 ELSE 0 END AS is_travel,
  h.rate AS rate_val,
  h.amount_payable AS amount_payable_val,
  h.branch_approved AS branch_approved_val,
  h.ho_approved AS ho_approved_val,
  h.amount_payable AS raw_nchargespayable,
  h.branch_approved AS raw_nbmapprovedamt,
  h.ho_approved AS raw_nhoapprovedamt
FROM arcp_lines_hot h
LEFT JOIN dim_offices fr ON fr.ncode = h.nofficeid
LEFT JOIN dim_offices br ON br.ncode = h.office_under
WHERE ${whereSql}
ORDER BY h.${orderCol} DESC NULLS LAST, h.ncode DESC
`;

  return withClient(async (client) => {
    const result = await client.query(query, params);
    return result.rows.map((row) => {
      const isTravel = Number(row.is_travel) === 1;
      const callType = String(row.call_type_label ?? row.ncalltype ?? '');
      const itemCat = String(row.item_category_label ?? '');
      const localLabel =
        String(row.local_upcountry_label ?? '') ||
        LOCAL_UPCOUNTRY_NCODE_LABELS[String(row.nlocalupcountry ?? '').trim()] ||
        '';

      const amountPayable = row.amount_payable_val != null ? Number(row.amount_payable_val) : null;
      const branchApproved =
        row.branch_approved_val != null ? Number(row.branch_approved_val) : null;
      const hoApproved = row.ho_approved_val != null ? Number(row.ho_approved_val) : null;

      let summarySection = '';
      if (isTravel) summarySection = 'Reimbursement of Travel Expenses';
      else if (!itemCat) summarySection = '';
      else if (!callType) summarySection = itemCat;
      else summarySection = `${callType} – ${itemCat}`;

      const subKey = `${localLabel || 'Unknown'} - ${row.major_minor || 'Minor'}`;

      return {
        ncode: String(row.ncode ?? ''),
        vucnno: String(row.vucnno ?? ''),
        calls2fault_code: String(row.calls2fault_code ?? ''),
        call_no: hasCallNo ? String(row.call_no ?? '').trim() : '',
        franchisee_code: String(row.franchisee_code ?? ''),
        branch_name: String(row.branch_name ?? ''),
        franchisee_name: String(row.franchisee_name ?? ''),
        call_date: formatArcpClaimsExportDate(row.call_at),
        solve_date: formatArcpClaimsExportDate(row.solve_at),
        bm_approved_date: formatArcpClaimsExportDate(row.bm_approved_at),
        ho_approved_date: formatArcpClaimsExportDate(row.ho_approved_at),
        call_type: callType,
        item_category: itemCat,
        local_upcountry: localLabel,
        major_minor: String(row.major_minor ?? 'Minor'),
        line_type: isTravel ? 'Travel' : 'Service',
        rate: row.rate_val != null ? Number(row.rate_val) : null,
        distance: null,
        amount_payable: amountPayable,
        branch_approved: branchApproved,
        ho_approved: hoApproved,
        raw_nchargespayable: amountPayable,
        raw_nbmapprovedamt: branchApproved,
        raw_nhoapprovedamt: hoApproved,
        raw_napproval1amount: branchApproved,
        raw_napproval2amount: hoApproved,
        summary_section: summarySection,
        summary_sub_row: subKey,
        payable_minus_branch:
          amountPayable != null && branchApproved != null ? amountPayable - branchApproved : null,
        payable_minus_ho:
          amountPayable != null && hoApproved != null ? amountPayable - hoApproved : null,
      } satisfies ArcpClaimsDetailRow;
    });
  });
}
