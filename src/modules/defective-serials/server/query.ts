import { withAppClient } from '@/lib/read-model/db';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';
import type {
  DefectiveSerialRow,
  DefectiveSerialStatus,
  DefectiveSerialsOptionsResponse,
  DefectiveSerialsRowsResponse,
} from '@/modules/defective-serials/types';
import { ensureDefectiveSerialsTable } from '@/modules/defective-serials/server/sync/postgres-sync';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DefectiveSerialsFilters = {
  status: DefectiveSerialStatus;
  search: string;
  startDate: string | null;
  endDate: string | null;
  plants: string[];
  branches: string[];
  callTypes: string[];
  page: number;
  pageSize: number;
  isHod: boolean;
  assignedOffices: string[];
};

/** Hot/mirror dims by vtrnno — no CRM. */
const HOT_DIMS_JOIN = `
LEFT JOIN calls_latest_hot h ON h.vtrnno = d.vtrnno
LEFT JOIN calls_crm_mirror m ON m.vtrnno = d.vtrnno
LEFT JOIN dim_offices fo ON fo.ncode = (
  CASE
    WHEN btrim(COALESCE(h.franchisee_code, m.franchisee_code, '')) ~ '^[0-9]+(\\.[0-9]+)?$'
    THEN trunc(btrim(COALESCE(h.franchisee_code, m.franchisee_code))::numeric)::bigint
    ELSE NULL
  END
)
`;

const EFF_CALL_TYPE = `COALESCE(NULLIF(btrim(d.call_type), ''), NULLIF(btrim(h.call_type), ''), NULLIF(btrim(m.call_type), ''))`;
const EFF_BRANCH = `COALESCE(NULLIF(btrim(h.branch_name), ''), NULLIF(btrim(m.branch_name), ''), NULLIF(btrim(d.branch_name), ''))`;
const EFF_VENDOR_NAME = `COALESCE(NULLIF(btrim(d.vendor_name), ''), NULLIF(btrim(h.franchisee_name), ''), NULLIF(btrim(m.franchisee_name), ''))`;
const EFF_VENDOR_CODE = `COALESCE(NULLIF(btrim(d.vendor_code), ''), NULLIF(btrim(fo.vsapvendorcode), ''))`;
const EFF_PLANT = `COALESCE(
  NULLIF(btrim(d.plant_code), ''),
  NULLIF(substring(btrim(${EFF_BRANCH}) from '^[0-9]+'), '')
)`;

function parseCsvList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'All');
}

function defaultMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${day}`,
  };
}

export function parseDefectiveSerialsFilters(
  searchParams: URLSearchParams
): Omit<DefectiveSerialsFilters, 'isHod' | 'assignedOffices'> {
  const statusRaw = (searchParams.get('status') || 'all').trim().toLowerCase();
  const status: DefectiveSerialStatus =
    statusRaw === 'done' || statusRaw === 'pending' ? statusRaw : 'all';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50)
  );
  const defaults = defaultMonthRange();
  const startRaw = searchParams.get('startDate')?.trim() || defaults.startDate;
  const endRaw = searchParams.get('endDate')?.trim() || defaults.endDate;
  const startDate = YMD_RE.test(startRaw) ? startRaw : defaults.startDate;
  const endDate = YMD_RE.test(endRaw) ? endRaw : defaults.endDate;

  return {
    status,
    search: (searchParams.get('search') || '').trim(),
    startDate,
    endDate,
    plants: parseCsvList(searchParams.get('plants')),
    branches: parseCsvList(searchParams.get('branches')),
    callTypes: parseCsvList(searchParams.get('callTypes')),
    page,
    pageSize,
  };
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapRow(r: Record<string, unknown>): DefectiveSerialRow {
  const done = Boolean(r.breturntobranch);
  return {
    ncode: String(r.ncode ?? ''),
    ncalls: String(r.ncalls ?? ''),
    nofficeid: String(r.nofficeid ?? ''),
    vtrnno: String(r.vtrnno ?? ''),
    dtrndate: isoOrNull(r.dtrndate),
    party_name: r.party_name != null ? String(r.party_name) : null,
    client_name: r.client_name != null ? String(r.client_name) : null,
    model: r.model != null ? String(r.model) : null,
    machine_serial: r.machine_serial != null ? String(r.machine_serial) : null,
    city: r.city != null ? String(r.city) : null,
    call_centre_call_id:
      r.call_centre_call_id != null ? String(r.call_centre_call_id) : null,
    branch_name: r.branch_name != null ? String(r.branch_name) : null,
    plant_code: r.plant_code != null ? String(r.plant_code) : null,
    call_type: r.call_type != null ? String(r.call_type) : null,
    vendor_name: r.vendor_name != null ? String(r.vendor_name) : null,
    vendor_code: r.vendor_code != null ? String(r.vendor_code) : null,
    defective_item_code:
      r.defective_item_code != null ? String(r.defective_item_code) : null,
    defective_item_name:
      r.defective_item_name != null ? String(r.defective_item_name) : null,
    voldserialno: r.voldserialno != null ? String(r.voldserialno) : null,
    breturntobranch: done,
    dreturntobranchdate: isoOrNull(r.dreturntobranchdate),
    nreturntobranch:
      r.nreturntobranch != null ? String(r.nreturntobranch) : null,
    return_by_name:
      r.return_by_name != null && String(r.return_by_name).trim() !== ''
        ? String(r.return_by_name)
        : null,
    status: done ? 'done' : 'pending',
  };
}

type WhereBuilt = { where: string[]; params: unknown[] };

function buildWhere(
  filters: DefectiveSerialsFilters,
  opts?: { includeStatus?: boolean; includeSearch?: boolean }
): WhereBuilt {
  const includeStatus = opts?.includeStatus !== false;
  const includeSearch = opts?.includeSearch !== false;
  const params: unknown[] = [];
  const where: string[] = [];

  if (includeStatus) {
    if (filters.status === 'pending') {
      where.push(`NOT COALESCE(d.breturntobranch, false)`);
    } else if (filters.status === 'done') {
      where.push(`COALESCE(d.breturntobranch, false)`);
    }
  }

  if (filters.startDate) {
    params.push(filters.startDate);
    where.push(
      `(d.dtrndate AT TIME ZONE 'Asia/Kolkata')::date >= $${params.length}::date`
    );
  }
  if (filters.endDate) {
    params.push(filters.endDate);
    where.push(
      `(d.dtrndate AT TIME ZONE 'Asia/Kolkata')::date <= $${params.length}::date`
    );
  }

  if (shouldRestrictToAssignedOffices(filters.isHod, filters.assignedOffices)) {
    params.push(filters.assignedOffices.map(Number));
    where.push(`d.nofficeid::bigint = ANY($${params.length}::bigint[])`);
  }

  if (filters.plants.length > 0) {
    params.push(filters.plants.map((p) => p.toUpperCase()));
    where.push(`upper(btrim(${EFF_PLANT})) = ANY($${params.length}::text[])`);
  }
  if (filters.branches.length > 0) {
    params.push(filters.branches.map((b) => b.toUpperCase()));
    where.push(`upper(btrim(${EFF_BRANCH})) = ANY($${params.length}::text[])`);
  }
  if (filters.callTypes.length > 0) {
    params.push(filters.callTypes.map((t) => t.toUpperCase()));
    where.push(`upper(btrim(${EFF_CALL_TYPE})) = ANY($${params.length}::text[])`);
  }

  if (includeSearch && filters.search) {
    params.push(`%${filters.search}%`);
    const i = params.length;
    where.push(
      `(d.vtrnno ILIKE $${i} OR COALESCE(d.voldserialno,'') ILIKE $${i} OR COALESCE(d.party_name,'') ILIKE $${i} OR COALESCE(d.machine_serial,'') ILIKE $${i} OR COALESCE(d.defective_item_code,'') ILIKE $${i} OR COALESCE(${EFF_VENDOR_NAME},'') ILIKE $${i} OR COALESCE(${EFF_VENDOR_CODE},'') ILIKE $${i} OR COALESCE(${EFF_PLANT},'') ILIKE $${i})`
    );
  }

  return { where, params };
}

const SELECT_COLS = `
  d.ncode, d.ncalls, d.nofficeid, d.vtrnno, d.dtrndate, d.party_name, d.client_name,
  d.model, d.machine_serial, d.city, d.call_centre_call_id,
  ${EFF_BRANCH} AS branch_name,
  ${EFF_PLANT} AS plant_code,
  ${EFF_CALL_TYPE} AS call_type,
  ${EFF_VENDOR_NAME} AS vendor_name,
  ${EFF_VENDOR_CODE} AS vendor_code,
  d.defective_item_code, d.defective_item_name, d.voldserialno,
  d.breturntobranch, d.dreturntobranchdate, d.nreturntobranch, d.return_by_name
`;

export async function fetchDefectiveSerialsRows(
  filters: DefectiveSerialsFilters
): Promise<DefectiveSerialsRowsResponse> {
  return withAppClient(async (client) => {
    await ensureDefectiveSerialsTable(client);

    const { where, params } = buildWhere(filters);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countFilters = { ...filters, status: 'all' as const, search: '' };
    const countBuilt = buildWhere(countFilters, {
      includeStatus: false,
      includeSearch: false,
    });
    const countWhereSql = countBuilt.where.length
      ? `WHERE ${countBuilt.where.join(' AND ')}`
      : '';

    const countsRes = await client.query<{ pending: string; done: string }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE NOT COALESCE(d.breturntobranch, false))::text AS pending,
        COUNT(*) FILTER (WHERE COALESCE(d.breturntobranch, false))::text AS done
      FROM defective_serials d
      ${HOT_DIMS_JOIN}
      ${countWhereSql}
      `,
      countBuilt.params
    );

    const totalRes = await client.query<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM defective_serials d
      ${HOT_DIMS_JOIN}
      ${whereSql}
      `,
      params
    );
    const total = Number(totalRes.rows[0]?.n ?? 0);
    const offset = (filters.page - 1) * filters.pageSize;
    const pageParams = [...params, filters.pageSize, offset];

    const rowsRes = await client.query(
      `
      SELECT ${SELECT_COLS}
      FROM defective_serials d
      ${HOT_DIMS_JOIN}
      ${whereSql}
      ORDER BY d.dtrndate DESC NULLS LAST, d.vtrnno DESC, d.ncode DESC
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
      `,
      pageParams
    );

    return {
      rows: rowsRes.rows.map((r) => mapRow(r as Record<string, unknown>)),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      pendingCount: Number(countsRes.rows[0]?.pending ?? 0),
      doneCount: Number(countsRes.rows[0]?.done ?? 0),
    };
  });
}

export async function fetchDefectiveSerialsOptions(scope: {
  startDate: string | null;
  endDate: string | null;
  isHod: boolean;
  assignedOffices: string[];
}): Promise<DefectiveSerialsOptionsResponse> {
  return withAppClient(async (client) => {
    await ensureDefectiveSerialsTable(client);
    const base: DefectiveSerialsFilters = {
      status: 'all',
      search: '',
      startDate: scope.startDate,
      endDate: scope.endDate,
      plants: [],
      branches: [],
      callTypes: [],
      page: 1,
      pageSize: 1,
      isHod: scope.isHod,
      assignedOffices: scope.assignedOffices,
    };
    const { where, params } = buildWhere(base, {
      includeStatus: false,
      includeSearch: false,
    });
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [plants, branches, callTypes] = await Promise.all([
      client.query<{ plant_code: string }>(
        `
        SELECT DISTINCT btrim(${EFF_PLANT}) AS plant_code
        FROM defective_serials d
        ${HOT_DIMS_JOIN}
        ${whereSql ? `${whereSql} AND` : 'WHERE'} coalesce(btrim(${EFF_PLANT}), '') <> ''
        ORDER BY 1
        `,
        params
      ),
      client.query<{ branch_name: string }>(
        `
        SELECT DISTINCT btrim(${EFF_BRANCH}) AS branch_name
        FROM defective_serials d
        ${HOT_DIMS_JOIN}
        ${whereSql ? `${whereSql} AND` : 'WHERE'} coalesce(btrim(${EFF_BRANCH}), '') <> ''
        ORDER BY 1
        `,
        params
      ),
      client.query<{ call_type: string }>(
        `
        SELECT DISTINCT btrim(${EFF_CALL_TYPE}) AS call_type
        FROM defective_serials d
        ${HOT_DIMS_JOIN}
        ${whereSql ? `${whereSql} AND` : 'WHERE'} coalesce(btrim(${EFF_CALL_TYPE}), '') <> ''
        ORDER BY 1
        `,
        params
      ),
    ]);

    return {
      plants: plants.rows.map((r) => r.plant_code),
      branches: branches.rows.map((r) => r.branch_name),
      callTypes: callTypes.rows.map((r) => r.call_type),
    };
  });
}
