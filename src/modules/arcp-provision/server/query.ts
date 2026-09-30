import { withAppClient } from '@/lib/read-model/db';
import { formatExportDate } from '@/lib/utils/export-dates';
import { ARCP_REPORT_TIMEZONE } from '@/modules/arcp-claims';
import {
  resolveArcpDateFilterColumn,
  isArcpApproveDateColumn,
  type ArcpDateFilterColumn,
} from '@/sql/arcp-claims/query';
import { PROVISION_IS_MAJOR_SQL } from '@/modules/arcp-provision/server/major-repair';
import type {
  ArcpProvisionAggregateRow,
  ArcpProvisionCategoryAggregateRow,
  ArcpProvisionDetailRow,
  ArcpProvisionFilters,
  ArcpProvisionOptions,
  ArcpProvisionSummary,
} from '@/modules/arcp-provision/types';

/** Provision date basis — includes CRM tdcalls10arcp.editedon as Branch Call Approved. */
export type ArcpProvisionDateFilterColumn = ArcpDateFilterColumn | 'source_editedon';

export function resolveProvisionDateFilterColumn(
  column: string | null | undefined
): ArcpProvisionDateFilterColumn {
  if (column === 'source_editedon') return 'source_editedon';
  return resolveArcpDateFilterColumn(column);
}

/** Format hot source_editedon (= CRM tdcalls10arcp.editedon) for UI/CSV. */
function formatBranchCallApproved(value: unknown): string | null {
  if (value == null || value === '') return null;
  const formatted = formatExportDate(value);
  return formatted || null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Inclusive calendar-day bounds as timestamptz range (sargable). */
function appendDateRange(
  parts: string[],
  params: unknown[],
  idx: number,
  tsCol: string,
  startDate: string | null,
  endDate: string | null
): number {
  if (startDate) {
    parts.push(`${tsCol} >= ($${idx}::timestamp AT TIME ZONE '${ARCP_REPORT_TIMEZONE}')`);
    params.push(`${startDate} 00:00:00`);
    idx += 1;
  }
  if (endDate) {
    parts.push(
      `${tsCol} < (($${idx}::date + 1)::timestamp AT TIME ZONE '${ARCP_REPORT_TIMEZONE}')`
    );
    params.push(endDate);
    idx += 1;
  }
  return idx;
}

function resolveTsCol(dateColumn: ArcpProvisionDateFilterColumn): string {
  if (dateColumn === 'source_editedon') return 'h.source_editedon';
  if (dateColumn === 'bm_approved_at') return 'h.bm_approved_at';
  if (dateColumn === 'dsolveddatetime') return 'h.solve_at';
  return 'h.call_at';
}

function parseCsvIds(param: string | null | undefined): string[] | null {
  if (!param || param === 'All' || param === 'undefined' || param === 'null') return null;
  const values = param
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

export function parseArcpProvisionFilters(
  searchParams: URLSearchParams,
  scope: { isHod: boolean; assignedOffices: string[] }
): ArcpProvisionFilters {
  return {
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    dateFilterColumn: resolveProvisionDateFilterColumn(searchParams.get('dateFilterColumn')),
    branch: searchParams.get('branch'),
    franchisee: searchParams.get('franchisee'),
    callType: searchParams.get('callType'),
    isHod: scope.isHod,
    assignedOffices: scope.assignedOffices,
  };
}

/** Exclude cancelled calls (vucnno = cancelled vtrnno). */
function buildWhere(
  filters: ArcpProvisionFilters,
  opts?: { lineKind?: 'service' | 'travel' | 'all' }
): { sql: string; params: unknown[] } {
  const dateColumn = resolveProvisionDateFilterColumn(filters.dateFilterColumn);
  const tsCol = resolveTsCol(dateColumn);
  const lineKind = opts?.lineKind ?? 'service';
  const parts: string[] = [
    `h.is_rejected = false`,
    `NOT EXISTS (SELECT 1 FROM calls_cancelled c WHERE c.vtrnno = h.vucnno)`,
  ];
  if (lineKind === 'service') parts.push(`h.is_travel = false`);
  if (lineKind === 'travel') parts.push(`h.is_travel = true`);
  const params: unknown[] = [];
  let idx = 1;

  if (isArcpApproveDateColumn(dateColumn) || dateColumn === 'source_editedon') {
    parts.push(`${tsCol} IS NOT NULL`);
  }

  idx = appendDateRange(parts, params, idx, tsCol, filters.startDate, filters.endDate);

  const branches = parseCsvIds(filters.branch);
  if (branches) {
    parts.push(`h.office_under = ANY($${idx}::bigint[])`);
    params.push(branches.map((b) => Number(b)));
    idx += 1;
  }

  const franchisees = parseCsvIds(filters.franchisee);
  if (franchisees) {
    parts.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    params.push(franchisees.map((f) => Number(f)));
    idx += 1;
  }

  const callTypes = parseCsvIds(filters.callType);
  if (callTypes) {
    parts.push(`h.call_type_label = ANY($${idx}::text[])`);
    params.push(callTypes);
    idx += 1;
  }

  if (!filters.isHod && filters.assignedOffices.length > 0) {
    const ids = filters.assignedOffices.map((o) => Number(o)).filter((n) => Number.isFinite(n));
    parts.push(`(h.nofficeid = ANY($${idx}::bigint[]) OR h.office_under = ANY($${idx}::bigint[]))`);
    params.push(ids);
    idx += 1;
  }

  return { sql: parts.join(' AND '), params };
}

/**
 * Per-line rate: indexed on r.noffice (= branch office_under).
 * BREAKDOWN Major (Gas Charging Done / Compressor Replaced) → rate-card nrepairtype 6/19.
 * Everything else → blank nrepairtype (Minor) rate row.
 */
const RATE_LATERAL = `
LEFT JOIN LATERAL (
  SELECT r.nchargespayable AS rate_card_unit
  FROM arcp_rate_card_hot r
  WHERE NOT h.is_travel
    AND r.noffice = COALESCE(h.office_under, h.nofficeid)
    AND r.nitemcategory IS NOT DISTINCT FROM NULLIF(BTRIM(h.nitemcategory), '')
    AND r.nlocalupcountry IS NOT DISTINCT FROM NULLIF(BTRIM(h.nlocalupcountry), '')
    AND (
      NULLIF(TRIM(COALESCE(r.ncalltype, '')), '') IS NULL
      OR NULLIF(TRIM(COALESCE(r.ncalltype, '')), '') = NULLIF(TRIM(COALESCE(h.ncalltype, '')), '')
    )
    AND (
      h.ntat IS NULL
      OR r.ntat_from IS NULL
      OR r.ntat_to IS NULL
      OR (h.ntat >= r.ntat_from AND h.ntat <= r.ntat_to)
    )
    AND (
      (
        ${PROVISION_IS_MAJOR_SQL}
        AND (
          NULLIF(BTRIM(r.nrepairtype), '') IN ('6', '19')
          OR (
            NULLIF(BTRIM(h.nrepairtype), '') IS NOT NULL
            AND r.nrepairtype = h.nrepairtype
          )
        )
      )
      OR (
        NOT (${PROVISION_IS_MAJOR_SQL})
        AND (r.nrepairtype IS NULL OR BTRIM(r.nrepairtype) = '')
      )
    )
  ORDER BY
    CASE
      WHEN NULLIF(BTRIM(h.nrepairtype), '') IS NOT NULL
       AND r.nrepairtype = h.nrepairtype
      THEN 0
      WHEN NULLIF(BTRIM(r.nrepairtype), '') IN ('6', '19') THEN 1
      WHEN NULLIF(TRIM(COALESCE(r.ncalltype, '')), '')
         = NULLIF(TRIM(COALESCE(h.ncalltype, '')), '')
      THEN 2
      ELSE 3
    END,
    r.ntat_from NULLS LAST,
    r.ncode
  LIMIT 1
) rate ON true
`;

/**
 * Display call number = service order (vucnno), e.g. 26E14210.
 * Hot `call_no` is trdcalls2fault.ncalls (short numeric) — not the UCN users recognize.
 */
const CALL_NO_SQL = `COALESCE(
  NULLIF(BTRIM(h.vucnno), ''),
  CASE
    WHEN BTRIM(COALESCE(h.call_no, '')) ~ '^[0-9]{2}[A-Za-z]' THEN BTRIM(h.call_no)
    ELSE NULL
  END,
  ''
)`;

type OfficeLookup = {
  names: Record<string, string>;
  vendors: Record<string, string>;
};

async function loadOfficeLookup(): Promise<OfficeLookup> {
  return withAppClient(async (client) => {
    const result = await client.query<{
      ncode: string | number;
      vcompanyname: string | null;
      vsapvendorcode: string | null;
    }>(`SELECT ncode, vcompanyname, vsapvendorcode FROM dim_offices`);
    const names: Record<string, string> = {};
    const vendors: Record<string, string> = {};
    for (const row of result.rows) {
      const code = String(row.ncode ?? '').trim();
      if (!code) continue;
      names[code] = String(row.vcompanyname ?? '').trim() || code;
      const vendor = String(row.vsapvendorcode ?? '').trim();
      if (vendor) vendors[code] = vendor;
    }
    return { names, vendors };
  });
}

export async function fetchArcpProvisionAggregates(
  filters: ArcpProvisionFilters
): Promise<ArcpProvisionAggregateRow[]> {
  const { sql: whereSql, params } = buildWhere(filters, { lineKind: 'all' });
  const [offices, result] = await Promise.all([
    loadOfficeLookup(),
    withAppClient(async (client) =>
      client.query(
        `
      SELECT
        COALESCE(h.office_under, h.nofficeid)::text AS branch_id,
        h.nofficeid::text AS franchisee_id,
        COUNT(*) FILTER (WHERE NOT h.is_travel)::int AS qty,
        SUM(rate.rate_card_unit) FILTER (WHERE NOT h.is_travel AND rate.rate_card_unit IS NOT NULL) AS rate_mst,
        COALESCE(SUM(h.amount_payable) FILTER (WHERE NOT h.is_travel), 0) AS rate_crm,
        COALESCE(SUM(h.amount_payable) FILTER (WHERE h.is_travel), 0) AS travel_amount
      FROM arcp_lines_hot h
      ${RATE_LATERAL}
      WHERE ${whereSql}
      GROUP BY COALESCE(h.office_under, h.nofficeid), h.nofficeid
      HAVING COUNT(*) FILTER (WHERE NOT h.is_travel) > 0
         OR COALESCE(SUM(h.amount_payable) FILTER (WHERE h.is_travel), 0) <> 0
      `,
        params
      )
    ),
  ]);

  const rows: ArcpProvisionAggregateRow[] = result.rows.map((row) => {
    const branchId = String(row.branch_id ?? '').trim();
    const franchiseeId = String(row.franchisee_id ?? '').trim();
    const qty = Number(row.qty) || 0;
    const rateMst =
      row.rate_mst != null && Number.isFinite(Number(row.rate_mst))
        ? Number(row.rate_mst)
        : null;
    const rateCrm = Number(row.rate_crm) || 0;
    return {
      branch_id: branchId,
      branch_name: offices.names[branchId] ?? branchId,
      franchisee_id: franchiseeId,
      franchisee_name: offices.names[franchiseeId] ?? franchiseeId,
      vendor_code: offices.vendors[franchiseeId] ?? '',
      qty,
      rate_mst: rateMst,
      rate_crm: rateCrm,
      variance: rateMst == null ? null : rateCrm - rateMst,
      travel_amount: Number(row.travel_amount) || 0,
    };
  });

  rows.sort((a, b) => {
    const byBranch = a.branch_name.localeCompare(b.branch_name);
    if (byBranch !== 0) return byBranch;
    return a.franchisee_name.localeCompare(b.franchisee_name);
  });
  return rows;
}

/** Claims-style clubbed rows: branch + call type + category + local/major. */
export async function fetchArcpProvisionCategoryAggregates(
  filters: ArcpProvisionFilters
): Promise<ArcpProvisionCategoryAggregateRow[]> {
  const { sql: whereSql, params } = buildWhere(filters, { lineKind: 'all' });
  const [offices, result] = await Promise.all([
    loadOfficeLookup(),
    withAppClient(async (client) =>
      client.query(
        `
      SELECT
        COALESCE(h.office_under, h.nofficeid)::text AS branch_id,
        COALESCE(NULLIF(TRIM(h.ncalltype), ''), '') AS ncalltype,
        COALESCE(NULLIF(TRIM(h.call_type_label), ''), NULLIF(TRIM(h.ncalltype), ''), '') AS call_type_label,
        COALESCE(NULLIF(TRIM(h.nitemcategory), ''), '') AS nitemcategory,
        COALESCE(NULLIF(TRIM(h.item_category_label), ''), NULLIF(TRIM(h.nitemcategory), ''), '') AS item_category_label,
        COALESCE(NULLIF(TRIM(h.nlocalupcountry), ''), '') AS nlocalupcountry,
        COALESCE(NULLIF(TRIM(h.local_upcountry_label), ''), NULLIF(TRIM(h.nlocalupcountry), ''), '') AS local_upcountry_label,
        (${PROVISION_IS_MAJOR_SQL}) AS is_major,
        COUNT(*) FILTER (WHERE NOT h.is_travel)::int AS qty,
        CASE
          WHEN MIN(rate.rate_card_unit) FILTER (WHERE NOT h.is_travel AND rate.rate_card_unit IS NOT NULL)
             = MAX(rate.rate_card_unit) FILTER (WHERE NOT h.is_travel AND rate.rate_card_unit IS NOT NULL)
          THEN MIN(rate.rate_card_unit) FILTER (WHERE NOT h.is_travel AND rate.rate_card_unit IS NOT NULL)
          ELSE NULL
        END AS rate_card_unit,
        SUM(rate.rate_card_unit) FILTER (WHERE NOT h.is_travel AND rate.rate_card_unit IS NOT NULL) AS rate_mst,
        COALESCE(SUM(h.amount_payable) FILTER (WHERE NOT h.is_travel), 0) AS rate_crm,
        COALESCE(SUM(h.amount_payable) FILTER (WHERE h.is_travel), 0) AS travel_amount
      FROM arcp_lines_hot h
      ${RATE_LATERAL}
      WHERE ${whereSql}
      GROUP BY
        COALESCE(h.office_under, h.nofficeid),
        COALESCE(NULLIF(TRIM(h.ncalltype), ''), ''),
        COALESCE(NULLIF(TRIM(h.call_type_label), ''), NULLIF(TRIM(h.ncalltype), ''), ''),
        COALESCE(NULLIF(TRIM(h.nitemcategory), ''), ''),
        COALESCE(NULLIF(TRIM(h.item_category_label), ''), NULLIF(TRIM(h.nitemcategory), ''), ''),
        COALESCE(NULLIF(TRIM(h.nlocalupcountry), ''), ''),
        COALESCE(NULLIF(TRIM(h.local_upcountry_label), ''), NULLIF(TRIM(h.nlocalupcountry), ''), ''),
        (${PROVISION_IS_MAJOR_SQL})
      HAVING COUNT(*) FILTER (WHERE NOT h.is_travel) > 0
         OR COALESCE(SUM(h.amount_payable) FILTER (WHERE h.is_travel), 0) <> 0
      `,
        params
      )
    ),
  ]);

  const rows: ArcpProvisionCategoryAggregateRow[] = result.rows.map((row) => {
    const branchId = String(row.branch_id ?? '').trim();
    const qty = Number(row.qty) || 0;
    const rateUnit =
      row.rate_card_unit != null && Number.isFinite(Number(row.rate_card_unit))
        ? Number(row.rate_card_unit)
        : null;
    const rateMst =
      row.rate_mst != null && Number.isFinite(Number(row.rate_mst))
        ? Number(row.rate_mst)
        : null;
    const rateCrm = Number(row.rate_crm) || 0;
    const isMajor = Boolean(row.is_major);
    return {
      branch_id: branchId,
      branch_name: offices.names[branchId] ?? branchId,
      ncalltype: String(row.ncalltype ?? ''),
      call_type_label: String(row.call_type_label ?? ''),
      nitemcategory: String(row.nitemcategory ?? ''),
      item_category_label: String(row.item_category_label ?? ''),
      nlocalupcountry: String(row.nlocalupcountry ?? ''),
      local_upcountry_label: String(row.local_upcountry_label ?? ''),
      is_major: isMajor,
      major_minor: isMajor ? 'Major' : 'Minor',
      qty,
      rate_card_unit: rateUnit,
      rate_mst: rateMst,
      rate_crm: rateCrm,
      variance: rateMst == null ? null : rateCrm - rateMst,
      travel_amount: Number(row.travel_amount) || 0,
    };
  });

  rows.sort((a, b) => {
    const byBranch = a.branch_name.localeCompare(b.branch_name);
    if (byBranch !== 0) return byBranch;
    const byType = a.call_type_label.localeCompare(b.call_type_label);
    if (byType !== 0) return byType;
    const byCat = a.item_category_label.localeCompare(b.item_category_label);
    if (byCat !== 0) return byCat;
    return a.major_minor.localeCompare(b.major_minor);
  });
  return rows;
}

export function summarizeArcpProvisionAggregates(
  rows: ArcpProvisionAggregateRow[]
): ArcpProvisionSummary {
  let qty = 0;
  let rateMst = 0;
  let rateCrm = 0;
  let travelAmount = 0;
  let unmatchedQty = 0;
  for (const row of rows) {
    qty += row.qty;
    rateCrm += row.rate_crm;
    travelAmount += row.travel_amount;
    if (row.rate_mst == null) unmatchedQty += row.qty;
    else rateMst += row.rate_mst;
  }
  return {
    qty,
    rateMst,
    rateCrm,
    variance: rateCrm - rateMst,
    travelAmount,
    unmatchedQty,
  };
}

export async function fetchArcpProvisionSummary(
  filters: ArcpProvisionFilters
): Promise<ArcpProvisionSummary> {
  return summarizeArcpProvisionAggregates(await fetchArcpProvisionAggregates(filters));
}

export async function fetchArcpProvisionDetail(
  filters: ArcpProvisionFilters,
  opts?: { limit?: number; offset?: number; lineKind?: 'service' | 'travel' | 'all' }
): Promise<{ rows: ArcpProvisionDetailRow[]; total: number }> {
  const lineKind = opts?.lineKind ?? 'service';
  const { sql: whereSql, params } = buildWhere(filters, { lineKind });
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  return withAppClient(async (client) => {
    const countRes = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM arcp_lines_hot h WHERE ${whereSql}`,
      params
    );
    const total = countRes.rows[0]?.count ?? 0;

    const limIdx = params.length + 1;
    const offIdx = params.length + 2;
    const result = await client.query(
      `
      SELECT
        h.ncode,
        ${CALL_NO_SQL} AS call_no,
        COALESCE(h.office_under, h.nofficeid)::text AS branch_id,
        COALESCE(NULLIF(TRIM(br.vcompanyname), ''), COALESCE(h.office_under, h.nofficeid)::text) AS branch_name,
        h.nofficeid::text AS franchisee_id,
        COALESCE(NULLIF(TRIM(fo.vcompanyname), ''), h.nofficeid::text) AS franchisee_name,
        COALESCE(NULLIF(TRIM(fo.vsapvendorcode), ''), '') AS vendor_code,
        h.source_editedon AS branch_call_approved_at,
        COALESCE(NULLIF(TRIM(h.call_type_label), ''), '') AS call_type,
        COALESCE(NULLIF(TRIM(h.item_category_label), ''), '') AS item_category,
        COALESCE(NULLIF(TRIM(h.local_upcountry_label), ''), '') AS local_upcountry,
        CASE WHEN (${PROVISION_IS_MAJOR_SQL}) THEN 'Major' ELSE 'Minor' END AS major_minor,
        COALESCE(NULLIF(TRIM(h.repair_label), ''), NULLIF(TRIM(h.nrepairtype), ''), '') AS repair_done,
        h.ntat,
        h.is_travel,
        h.rate AS travel_rate,
        rate.rate_card_unit,
        COALESCE(h.amount_payable, 0) AS crm_charged
      FROM arcp_lines_hot h
      LEFT JOIN dim_offices fo ON fo.ncode = h.nofficeid
      LEFT JOIN dim_offices br ON br.ncode = COALESCE(h.office_under, h.nofficeid)
      ${RATE_LATERAL}
      WHERE ${whereSql}
      ORDER BY branch_name, franchisee_name, h.is_travel, h.call_at DESC NULLS LAST, h.ncode DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
      `,
      [...params, limit, offset]
    );

    const rows: ArcpProvisionDetailRow[] = result.rows.map((row) => {
      const unit =
        row.rate_card_unit != null && Number.isFinite(Number(row.rate_card_unit))
          ? Number(row.rate_card_unit)
          : null;
      const charged = Number(row.crm_charged) || 0;
      const travelRate =
        row.travel_rate != null && Number.isFinite(Number(row.travel_rate))
          ? Number(row.travel_rate)
          : null;
      return {
        ncode: String(row.ncode ?? ''),
        call_no: String(row.call_no ?? '').trim(),
        branch_id: String(row.branch_id ?? '').trim(),
        branch_name: String(row.branch_name ?? '').trim(),
        franchisee_id: String(row.franchisee_id ?? '').trim(),
        franchisee_name: String(row.franchisee_name ?? '').trim(),
        vendor_code: String(row.vendor_code ?? '').trim(),
        branch_call_approved_at: toIsoOrNull(row.branch_call_approved_at),
        call_type: String(row.call_type ?? ''),
        item_category: String(row.item_category ?? ''),
        local_upcountry: String(row.local_upcountry ?? ''),
        major_minor: String(row.major_minor ?? ''),
        repair_done: String(row.repair_done ?? ''),
        ntat: row.ntat != null && Number.isFinite(Number(row.ntat)) ? Number(row.ntat) : null,
        is_travel: Boolean(row.is_travel),
        travel_rate: travelRate,
        rate_card_unit: unit,
        crm_charged: charged,
        variance: unit == null ? null : charged - unit,
      };
    });

    return { rows, total };
  });
}

export async function fetchArcpProvisionOptions(
  filters: Pick<
    ArcpProvisionFilters,
    'startDate' | 'endDate' | 'dateFilterColumn' | 'isHod' | 'assignedOffices'
  >
): Promise<ArcpProvisionOptions> {
  const { sql: whereSql, params } = buildWhere(
    {
      ...filters,
      branch: null,
      franchisee: null,
      callType: null,
    },
    { lineKind: 'service' }
  );

  return withAppClient(async (client) => {
    const result = await client.query<{
      office_under: string | number | null;
      nofficeid: string | number | null;
      branch_name: string | null;
      franchisee_name: string | null;
      call_type_label: string | null;
    }>(
      `
      SELECT DISTINCT
        h.office_under,
        h.nofficeid,
        br.vcompanyname AS branch_name,
        fo.vcompanyname AS franchisee_name,
        h.call_type_label
      FROM arcp_lines_hot h
      LEFT JOIN dim_offices fo ON fo.ncode = h.nofficeid
      LEFT JOIN dim_offices br ON br.ncode = h.office_under
      WHERE ${whereSql}
      `,
      params
    );

    const branchMap = new Map<string, string>();
    const franchiseeMap = new Map<string, string>();
    const callTypes = new Set<string>();

    for (const row of result.rows) {
      const under = String(row.office_under ?? '').trim();
      const officeId = String(row.nofficeid ?? '').trim();
      if (under) {
        branchMap.set(under, String(row.branch_name ?? '').trim() || under);
      }
      if (officeId) {
        franchiseeMap.set(officeId, String(row.franchisee_name ?? '').trim() || officeId);
      }
      const ct = String(row.call_type_label ?? '').trim();
      if (ct) callTypes.add(ct);
    }

    return {
      branches: Array.from(branchMap.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      franchisees: Array.from(franchiseeMap.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      callTypes: Array.from(callTypes).sort((a, b) => a.localeCompare(b)),
    };
  });
}

export function buildArcpProvisionCsv(
  aggregates: ArcpProvisionAggregateRow[],
  detail: ArcpProvisionDetailRow[]
): string {
  const totals = summarizeArcpProvisionAggregates(aggregates);
  const serviceRows = detail.filter((r) => !r.is_travel);
  const travelRows = detail.filter((r) => r.is_travel);
  const lines: string[] = [];

  // Same numbers as the on-screen KPI cards (service qty/crm/mst + travel separate).
  lines.push('REPORT TOTALS (matches screen KPIs)');
  lines.push('Qty,Rate as per Mst.,Rate as per CRM,Variance,Travel');
  lines.push(
    [totals.qty, totals.rateMst, totals.rateCrm, totals.variance, totals.travelAmount].join(',')
  );
  lines.push('');

  lines.push('VENDOR ROLLUP');
  lines.push(
    'Branch,Vendor Code,Franchisee,Rate as per Mst.,Rate as per CRM,Variance,Travel,Service Qty'
  );
  for (const row of aggregates) {
    lines.push(
      [
        csvEscape(row.branch_name),
        csvEscape(row.vendor_code),
        csvEscape(row.franchisee_name),
        row.rate_mst ?? '',
        row.rate_crm,
        row.variance ?? '',
        row.travel_amount,
        row.qty,
      ].join(',')
    );
  }
  lines.push('');

  lines.push('SERVICE LINES (qty = service calls only — do not add travel rows into Qty)');
  lines.push(
    'Call No,Branch,Vendor Code,Franchisee,Branch Call Approved,Call Type,Item Category,Local/Upcountry,Major/Minor,Repair Done,Qty,Rate × qty (Mst.),Rate as per CRM,Variance'
  );
  for (const row of serviceRows) {
    lines.push(
      [
        csvEscape(row.call_no),
        csvEscape(row.branch_name),
        csvEscape(row.vendor_code),
        csvEscape(row.franchisee_name),
        csvEscape(formatBranchCallApproved(row.branch_call_approved_at) ?? ''),
        csvEscape(row.call_type),
        csvEscape(row.item_category),
        csvEscape(row.local_upcountry),
        csvEscape(row.major_minor),
        csvEscape(row.repair_done),
        1,
        row.rate_card_unit ?? '',
        row.crm_charged,
        row.variance ?? '',
      ].join(',')
    );
  }
  lines.push(
    [
      'SERVICE SUBTOTAL',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      serviceRows.length,
      serviceRows.reduce((s, r) => s + (r.rate_card_unit ?? 0), 0),
      serviceRows.reduce((s, r) => s + r.crm_charged, 0),
      '',
    ].join(',')
  );
  lines.push('');

  lines.push('TRAVEL LINES (not counted in Qty / Rate Mst / Variance KPIs)');
  lines.push(
    'Call No,Branch,Vendor Code,Franchisee,Branch Call Approved,Travel amount (CRM)'
  );
  for (const row of travelRows) {
    lines.push(
      [
        csvEscape(row.call_no),
        csvEscape(row.branch_name),
        csvEscape(row.vendor_code),
        csvEscape(row.franchisee_name),
        csvEscape(formatBranchCallApproved(row.branch_call_approved_at) ?? ''),
        row.crm_charged,
      ].join(',')
    );
  }
  lines.push(
    ['TRAVEL SUBTOTAL', '', '', '', '', travelRows.reduce((s, r) => s + r.crm_charged, 0)].join(',')
  );

  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
