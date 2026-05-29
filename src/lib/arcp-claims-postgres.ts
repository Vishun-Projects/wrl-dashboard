import { withClient } from '@/lib/read-model/db';
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
} from '@/lib/arcp-claims-query';

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

function resolveDateCols(dateColumn: ArcpDateFilterColumn, alias?: string): DateCols {
  if (dateColumn === 'bm_approved_at') {
    const tsCol = colRef('bm_approved_at', alias);
    return { tsCol, monthCol: claimMonthExpr(tsCol) };
  }
  if (dateColumn === 'ho_approved_at') {
    const tsCol = colRef('ho_approved_at', alias);
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

  const query = `
SELECT
  ${monthCol} AS claim_month,
  h.ncalltype,
  MAX(
    COALESCE(
      NULLIF(TRIM(h.call_type_label), ''),
      ct.display_value,
      NULLIF(TRIM(h.ncalltype), '')
    )
  ) AS call_type_label,
  h.nitemcategory,
  MAX(
    COALESCE(
      NULLIF(TRIM(h.item_category_label), ''),
      NULLIF(TRIM(h.nitemcategory), '')
    )
  ) AS item_category_label,
  h.nlocalupcountry,
  MAX(
    COALESCE(
      NULLIF(TRIM(h.local_upcountry_label), ''),
      NULLIF(TRIM(h.nlocalupcountry), '')
    )
  ) AS local_upcountry_label,
  CASE WHEN h.is_travel THEN 1 ELSE 0 END AS is_travel,
  CASE WHEN h.is_major THEN 'Major' ELSE 'Minor' END AS major_minor,
  AVG(NULLIF(h.rate, 0)) AS rate,
  COUNT(DISTINCT h.ncode)::int AS qty,
  SUM(h.amount_payable) AS amount_payable,
  SUM(h.branch_approved) AS branch_approved,
  SUM(h.ho_approved) AS ho_approved
FROM arcp_lines_hot h
LEFT JOIN dim_call_types ct
  ON ct.ncode::text = NULLIF(TRIM(h.ncalltype), '')
WHERE ${whereSql}
GROUP BY
  ${monthCol},
  h.ncalltype,
  h.nitemcategory,
  h.nlocalupcountry,
  h.is_travel,
  h.is_major
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
  const { sql: whereSql, params } = buildArcpWhere(opts, dateColumn, 'h');

  const query = `
SELECT
  COUNT(DISTINCT h.ncode)::int AS line_count,
  COUNT(DISTINCT h.ncode) FILTER (WHERE h.is_travel)::int AS travel_line_count,
  COALESCE(SUM(h.amount_payable), 0)::float8 AS amount_payable,
  COALESCE(SUM(h.branch_approved), 0)::float8 AS branch_approved,
  COALESCE(SUM(h.ho_approved), 0)::float8 AS ho_approved
FROM arcp_lines_hot h
WHERE ${whereSql}
`;

  return withClient(async (client) => {
    const result = await client.query(query, params);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return parseArcpGrandTotals(row);
  });
}

function resolveDetailOrderCol(dateColumn: ArcpDateFilterColumn): string {
  if (dateColumn === 'bm_approved_at') return 'bm_approved_at';
  if (dateColumn === 'ho_approved_at') return 'ho_approved_at';
  if (dateColumn === 'dsolveddatetime') return 'solve_at';
  return 'call_at';
}

export async function queryArcpClaimsDetailRows(
  opts: ArcpClaimsQueryOpts
): Promise<ArcpClaimsDetailRow[]> {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const { sql: whereSql, params } = buildArcpWhere(opts, dateColumn, 'h');
  const orderCol = resolveDetailOrderCol(dateColumn);

  const query = `
SELECT
  h.vucnno,
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
ORDER BY h.${dateColumn === 'bm_approved_at' ? 'bm_approved_at' : dateColumn === 'ho_approved_at' ? 'ho_approved_at' : 'call_at'} DESC NULLS LAST, h.ncode DESC
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
        vucnno: String(row.vucnno ?? ''),
        calls2fault_code: String(row.calls2fault_code ?? ''),
        call_no: '',
        franchisee_code: String(row.franchisee_code ?? ''),
        branch_name: String(row.branch_name ?? ''),
        franchisee_name: String(row.franchisee_name ?? ''),
        call_date: row.call_at ? new Date(row.call_at).toISOString() : '',
        solve_date: row.solve_at ? new Date(row.solve_at).toISOString() : '',
        bm_approved_date: row.bm_approved_at
          ? new Date(row.bm_approved_at).toISOString()
          : '',
        ho_approved_date: row.ho_approved_at
          ? new Date(row.ho_approved_at).toISOString()
          : '',
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
