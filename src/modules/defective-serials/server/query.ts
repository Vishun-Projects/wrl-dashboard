import { withAppClient } from '@/lib/read-model/db';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';
import type {
  DefectiveSerialRow,
  DefectiveSerialStatus,
  DefectiveSerialsRowsResponse,
} from '@/modules/defective-serials/types';
import { ensureDefectiveSerialsTable } from '@/modules/defective-serials/server/sync/postgres-sync';

export type DefectiveSerialsFilters = {
  status: DefectiveSerialStatus;
  search: string;
  page: number;
  pageSize: number;
  isHod: boolean;
  assignedOffices: string[];
};

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
  return {
    status,
    search: (searchParams.get('search') || '').trim(),
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

export async function fetchDefectiveSerialsRows(
  filters: DefectiveSerialsFilters
): Promise<DefectiveSerialsRowsResponse> {
  return withAppClient(async (client) => {
    await ensureDefectiveSerialsTable(client);

    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.status === 'pending') {
      where.push(`NOT COALESCE(breturntobranch, false)`);
    } else if (filters.status === 'done') {
      where.push(`COALESCE(breturntobranch, false)`);
    }

    if (shouldRestrictToAssignedOffices(filters.isHod, filters.assignedOffices)) {
      params.push(filters.assignedOffices.map(Number));
      where.push(`nofficeid::bigint = ANY($${params.length}::bigint[])`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      const i = params.length;
      where.push(
        `(vtrnno ILIKE $${i} OR COALESCE(voldserialno,'') ILIKE $${i} OR COALESCE(party_name,'') ILIKE $${i} OR COALESCE(machine_serial,'') ILIKE $${i} OR COALESCE(defective_item_code,'') ILIKE $${i})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countsRes = await client.query<{ pending: string; done: string }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE NOT COALESCE(breturntobranch, false))::text AS pending,
        COUNT(*) FILTER (WHERE COALESCE(breturntobranch, false))::text AS done
      FROM defective_serials
      ${
        shouldRestrictToAssignedOffices(filters.isHod, filters.assignedOffices)
          ? `WHERE nofficeid::bigint = ANY($1::bigint[])`
          : ''
      }
      `,
      shouldRestrictToAssignedOffices(filters.isHod, filters.assignedOffices)
        ? [filters.assignedOffices.map(Number)]
        : []
    );

    const totalRes = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM defective_serials ${whereSql}`,
      params
    );
    const total = Number(totalRes.rows[0]?.n ?? 0);
    const offset = (filters.page - 1) * filters.pageSize;
    params.push(filters.pageSize, offset);

    const rowsRes = await client.query(
      `
      SELECT
        ncode, ncalls, nofficeid, vtrnno, dtrndate, party_name, client_name,
        model, machine_serial, city, call_centre_call_id, branch_name,
        defective_item_code, defective_item_name, voldserialno,
        breturntobranch, dreturntobranchdate, nreturntobranch, return_by_name
      FROM defective_serials
      ${whereSql}
      ORDER BY dtrndate DESC NULLS LAST, vtrnno DESC, ncode DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
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
