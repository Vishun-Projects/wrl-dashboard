import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { prisma } from '@/lib/prisma';
import { normalizeExactTrnSearch } from '@/lib/trhcalls-query';
import { mapCachedRowToRegisterRow } from '@/lib/report-search';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

const STATUS_LABEL_TO_BUCKET: Record<string, string> = {
  'Open Unallocated': 'open_unallocated',
  Assigned: 'assigned',
  'Tech. Solve Call': 'tech_solved',
  Closed: 'solved',
  Cancelled: 'cancelled',
};

export type RegisterPostgresParams = {
  page: number;
  limit: number;
  search: string;
  officeId: string;
  callType: string | null;
  startDate: string;
  endDate: string;
  status: string;
  account: string;
  region: string;
  pincode: string;
  priority: string;
  portalFilter: string;
  state: string;
  city: string;
  branch: string;
  franchisee: string;
  technician: string;
  fetchTotals: boolean;
  fetchFilterOptions?: boolean;
  assignedOffices: string[];
  visibleStatuses: string[];
  isHod: boolean;
};

function hotRowToRegisterRow(row: Record<string, unknown>): Record<string, unknown> {
  return mapCachedRowToRegisterRow({
    ncode: row.ncode,
    id: row.ncode,
    vtrnno: row.vtrnno,
    UniqueCallNo: row.vtrnno,
    vcclid: row.vcclid,
    nofficeid: row.nofficeid,
    officeId: row.nofficeid,
    office_under: row.office_under,
    parentId: row.office_under,
    nengineer: row.nengineer ?? 0,
    Pincode: row.pincode,
    pincode: row.pincode,
    city: row.city,
    state: row.state,
    region: row.region,
    account: row.account,
    PartyName: row.party_name,
    party_name: row.party_name,
    office_name: row.branch_name,
    officename: row.branch_name,
    branch_office_name: row.branch_name,
    franchisee_name: row.franchisee_name,
    franchisee_code: row.franchisee_code,
    serviceman: row.engineer_name,
    technician_name: row.engineer_name,
    calltype: row.call_type,
    call_type: row.call_type,
    itemname: row.item_name,
    callsvserialno: row.serial,
    vcomplaint: row.complaint,
    Status: row.status_label,
    callstatus: row.status_label,
    bsolved: row.bsolved,
    bfastclose: row.bfastclose,
    callsolved: row.bsolved,
    callsdtrndate: row.logged_at,
    callsolveddate: row.solved_at,
    vsolveremarks: row.solve_remarks,
    vpersoncalling: row.contact_person,
    vinsttel1: row.phone,
    vinstaddress: row.address,
    has_visit: row.has_visit ? 1 : 0,
    branch_headcount: row.branch_headcount,
    is_major_repair: row.is_major ? 'True' : 'False',
    ncancelreason: row.ncancelreason,
  });
}

async function mergeAuditEnrichment(rows: Record<string, unknown>[]) {
  if (!rows.length) return rows;
  const callIds = rows.map((r) => String(r.id ?? r.ncode));
  const [flagsRes, commentsRes] = await Promise.all([
    supabaseAdmin.from('call_flags').select('call_id, flag_type').in('call_id', callIds),
    supabaseAdmin
      .from('call_comments')
      .select('call_id, author_name, comment, content, created_at, author_id')
      .in('call_id', callIds)
      .order('created_at', { ascending: false }),
  ]);

  const flags = flagsRes.data || [];
  const comments = commentsRes.data || [];
  return rows.map((row) => {
    const id = String(row.id ?? row.ncode);
    const callFlag = flags.find((f) => f.call_id === id);
    const callComments = comments
      .filter((cm) => cm.call_id === id)
      .map((cm) => ({
        author_name: cm.author_name,
        comment: cm.comment || cm.content,
        created_at: cm.created_at,
        author_avatar_url: null,
      }));
    return {
      ...row,
      audit_flag: callFlag?.flag_type || null,
      comment_count: callComments.length,
      comments: callComments,
    };
  });
}

function buildWhere(params: RegisterPostgresParams): { sql: string; values: unknown[] } {
  const clauses: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (!params.isHod && params.assignedOffices.length > 0) {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.assignedOffices.map(Number));
    idx++;
  }

  if (params.officeId && params.officeId !== 'All') {
    const offices = params.officeId.split(',').map(Number);
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(offices);
    idx++;
  }

  if (params.startDate) {
    clauses.push(`h.logged_at >= $${idx}::timestamptz`);
    values.push(`${params.startDate}T00:00:00`);
    idx++;
  }
  if (params.endDate) {
    clauses.push(`h.logged_at <= $${idx}::timestamptz`);
    values.push(`${params.endDate}T23:59:59`);
    idx++;
  }

  if (params.callType && params.callType !== 'All') {
    const types = params.callType.split(',').map((t) => t.trim()).filter(Boolean);
    clauses.push(`upper(trim(h.call_type)) = ANY($${idx}::text[])`);
    values.push(types.map((t) => t.toUpperCase()));
    idx++;
  }

  if (params.account && params.account !== 'All') {
    clauses.push(`h.account ILIKE $${idx}`);
    values.push(`%${params.account}%`);
    idx++;
  }

  if (params.region && params.region !== 'All') {
    const regions = params.region.split(',').map((r) => r.trim().toUpperCase());
    clauses.push(`h.region = ANY($${idx}::text[])`);
    values.push(regions);
    idx++;
  }

  if (params.pincode) {
    clauses.push(`h.pincode ILIKE $${idx}`);
    values.push(`%${params.pincode}%`);
    idx++;
  }

  if (params.state && params.state !== 'All') {
    const states = params.state.split(',').map((s) => s.trim().toUpperCase());
    clauses.push(`h.state = ANY($${idx}::text[])`);
    values.push(states);
    idx++;
  }

  if (params.city && params.city !== 'All') {
    const cities = params.city.split(',').map((s) => s.trim().toUpperCase());
    clauses.push(`h.city = ANY($${idx}::text[])`);
    values.push(cities);
    idx++;
  }

  if (params.branch && params.branch !== 'All') {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.branch.split(',').map(Number));
    idx++;
  }

  if (params.franchisee && params.franchisee !== 'All') {
    clauses.push(`h.franchisee_code = ANY($${idx}::text[])`);
    values.push(params.franchisee.split(',').map((s) => s.trim()));
    idx++;
  }

  if (params.technician && params.technician !== 'All') {
    clauses.push(`h.nengineer = ANY($${idx}::bigint[])`);
    values.push(params.technician.split(',').map(Number));
    idx++;
  }

  if (params.priority === 'major') {
    clauses.push('h.is_major = true');
  } else if (params.priority === 'minor') {
    clauses.push('h.is_major = false');
  }

  const statuses =
    params.status && params.status !== 'All'
      ? params.status.split(',').map((s) => s.trim()).filter(Boolean)
      : !params.isHod && params.visibleStatuses.length > 0
        ? params.visibleStatuses
        : [];

  if (statuses.length > 0) {
    const buckets = statuses
      .map((s) => STATUS_LABEL_TO_BUCKET[s])
      .filter(Boolean);
    if (buckets.length === 0) {
      clauses.push('1=0');
    } else {
      clauses.push(`h.status_bucket = ANY($${idx}::status_bucket_type[])`);
      values.push(buckets);
      idx++;
    }
  }

  if (params.search.trim()) {
    const exact = normalizeExactTrnSearch(params.search);
    if (exact) {
      clauses.push(
        `(h.vtrnno = $${idx} OR h.vcclid = $${idx} OR cast(h.ncode as text) = $${idx} OR h.serial = $${idx})`
      );
      values.push(exact);
      idx++;
    } else if (/^\d+$/.test(params.search.trim())) {
      clauses.push(`(cast(h.ncode as text) = $${idx} OR h.vtrnno ILIKE $${idx + 1})`);
      values.push(params.search.trim(), `%${params.search.trim()}%`);
      idx += 2;
    } else {
      clauses.push(
        `(h.vtrnno ILIKE $${idx} OR h.party_name ILIKE $${idx} OR h.serial ILIKE $${idx} OR h.pincode ILIKE $${idx})`
      );
      values.push(`%${params.search.trim()}%`);
      idx++;
    }
  }

  return { sql: clauses.join(' AND '), values };
}

export async function queryRegisterFromPostgres(params: RegisterPostgresParams) {
  const { sql: whereSql, values } = buildWhere(params);
  const offset = (params.page - 1) * params.limit;
  const listValues = [...values, params.limit, offset];

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT h.*
    FROM calls_latest_hot h
    WHERE ${whereSql}
    ORDER BY h.logged_at DESC, h.ncode DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
    `,
    ...listValues
  );

  const mapped = (await mergeAuditEnrichment(rows.map(hotRowToRegisterRow))) as Record<
    string,
    unknown
  >[];

  const syncMeta = await getSyncMeta();
  const response: Record<string, unknown> = {
    data: mapped,
    readSource: 'postgres',
    syncMeta,
  };

  if (params.fetchTotals) {
    const summaryRows = await prisma.$queryRawUnsafe<
      Array<{
        total: number;
        cancelled: number;
        solved: number;
        open_calls: number;
        open_unallocated: number;
        assigned: number;
        tech_solved: number;
        closed: number;
      }>
    >(
      `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_calls,
        count(*) FILTER (WHERE h.status_bucket = 'open_unallocated')::int AS open_unallocated,
        count(*) FILTER (WHERE h.status_bucket = 'assigned')::int AS assigned,
        count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved,
        count(*) FILTER (WHERE h.status_bucket = 'solved')::int AS closed
      FROM calls_latest_hot h
      WHERE ${whereSql}
      `,
      ...values
    );

    const summary = summaryRows[0] ?? {
      total: 0,
      cancelled: 0,
      solved: 0,
      open_calls: 0,
      open_unallocated: 0,
      assigned: 0,
      tech_solved: 0,
      closed: 0,
    };

    response.total = summary.total;
    response.summary = {
      total: summary.total,
      cancelled: summary.cancelled,
      solved: summary.solved,
      open: summary.open_calls,
      openUnallocated: summary.open_unallocated,
      assigned: summary.assigned,
      techSolved: summary.tech_solved,
      closed: summary.closed,
    };

    if (params.fetchFilterOptions !== false) {
    const filterRows = await prisma.$queryRawUnsafe<
      Array<{
        nofficeid: number;
        branch_name: string | null;
        office_under: number | null;
        franchisee_code: string | null;
        franchisee_name: string | null;
        nengineer: number | null;
        engineer_name: string | null;
        pincode: string | null;
        city: string | null;
        state: string | null;
        call_count: number;
      }>
    >(
      `
      SELECT
        h.nofficeid,
        h.branch_name,
        h.office_under,
        h.franchisee_code,
        h.franchisee_name,
        h.nengineer,
        h.engineer_name,
        h.pincode,
        h.city,
        h.state,
        count(*)::int AS call_count
      FROM calls_latest_hot h
      WHERE ${whereSql}
      GROUP BY
        h.nofficeid, h.branch_name, h.office_under, h.franchisee_code,
        h.franchisee_name, h.nengineer, h.engineer_name, h.pincode, h.city, h.state
      `,
      ...values
    );

    const processedOptions = filterRows.map((row) =>
      mapCachedRowToRegisterRow({
        nofficeid: row.nofficeid,
        office_name: row.branch_name,
        office_under: row.office_under,
        franchisee_code: row.franchisee_code,
        franchisee_name: row.franchisee_name,
        nengineer: row.nengineer,
        technician_name: row.engineer_name,
        Pincode: row.pincode,
        city: row.city,
        state: row.state,
        call_count: row.call_count,
      })
    );

    response.statesList = aggregateDistinct(processedOptions, 'state');
    response.citiesList = aggregateDistinct(processedOptions, 'city');
    response.branchesList = aggregateDistinct(
      processedOptions,
      'resolved_branch_code',
      'officename'
    ).map((row) => ({ ncode: row.ncode, vcompanyname: row.vname, call_count: row.call_count }));
    response.franchiseesList = aggregateDistinct(
      processedOptions,
      'franchisee_code',
      'franchisee_name'
    ).map((row) => ({ ncode: row.ncode, vcompanyname: row.vname, call_count: row.call_count }));
    response.techniciansList = aggregateDistinct(processedOptions, 'nengineer', 'technician_name');
    }
  }

  return response;
}

const REGISTER_BULK_MAX_ROWS = 100_000;

export { REGISTER_BULK_MAX_ROWS };

/** One-shot preload for client-side register/distribution filtering (no OFFSET pagination). */
export async function queryRegisterBulkFromPostgres(
  params: Pick<
    RegisterPostgresParams,
    | 'officeId'
    | 'callType'
    | 'startDate'
    | 'endDate'
    | 'assignedOffices'
    | 'visibleStatuses'
    | 'isHod'
  >
) {
  const bulkParams: RegisterPostgresParams = {
    page: 1,
    limit: REGISTER_BULK_MAX_ROWS,
    search: '',
    account: '',
    region: '',
    status: '',
    pincode: '',
    priority: '',
    portalFilter: '',
    state: '',
    city: '',
    branch: '',
    franchisee: '',
    technician: '',
    fetchTotals: false,
    fetchFilterOptions: false,
    ...params,
  };

  const { sql: whereSql, values } = buildWhere(bulkParams);

  const rows = await prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(
    `
    SELECT h.*
    FROM calls_latest_hot h
    WHERE ${whereSql}
    ORDER BY h.logged_at DESC, h.ncode DESC
    LIMIT $${values.length + 1}
    `,
    ...values,
    REGISTER_BULK_MAX_ROWS
  );

  const mapped = rows.map(hotRowToRegisterRow) as Record<string, unknown>[];

  return {
    data: mapped,
    total: mapped.length,
    readSource: 'postgres' as const,
    bulk: true,
  };
}

/** All matching register rows for CSV export (server-side fallback). */
export async function queryRegisterExportFromPostgres(
  params: RegisterPostgresParams
): Promise<Record<string, unknown>[]> {
  const { sql: whereSql, values } = buildWhere(params);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT h.*
    FROM calls_latest_hot h
    WHERE ${whereSql}
    ORDER BY h.logged_at DESC, h.ncode DESC
    LIMIT $${values.length + 1}
    `,
    ...values,
    REGISTER_BULK_MAX_ROWS
  );

  return rows.map(hotRowToRegisterRow) as Record<string, unknown>[];
}

function aggregateDistinct(
  rows: Record<string, unknown>[],
  codeKey: string,
  nameKey?: string
) {
  const map = new Map<string, { ncode: string; vname: string; call_count: number }>();
  for (const row of rows) {
    const code = String(row[codeKey] ?? '');
    if (!code || code === 'UNKNOWN' || code === '0') continue;
    const name = String(row[nameKey ?? codeKey] ?? code);
    const existing = map.get(code) ?? { ncode: code, vname: name, call_count: 0 };
    existing.call_count += Number(row.call_count ?? 1);
    map.set(code, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.vname.localeCompare(b.vname));
}
