import { prisma } from '@/lib/prisma';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

export type DistributionQueryParams = {
  startDate?: string | null;
  endDate?: string | null;
  officeIds?: string[];
  callTypes?: string[];
  statuses?: string[];
  assignedOffices?: string[];
  isHod?: boolean;
  limit?: number;
};

export async function queryDistributionFromPostgres(params: DistributionQueryParams) {
  const limit = Math.min(params.limit ?? 2000, 2000);
  const clauses: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (!params.isHod && params.assignedOffices && params.assignedOffices.length > 0) {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.assignedOffices.map(Number));
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

  if (params.officeIds && params.officeIds.length > 0) {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.officeIds.map(Number));
    idx++;
  }

  if (params.callTypes && params.callTypes.length > 0) {
    clauses.push(`upper(trim(h.call_type)) = ANY($${idx}::text[])`);
    values.push(params.callTypes.map((t) => t.toUpperCase()));
    idx++;
  }

  if (params.statuses && params.statuses.length > 0) {
    clauses.push(`h.status_label = ANY($${idx}::text[])`);
    values.push(params.statuses);
    idx++;
  }

  const whereSql = clauses.join(' AND ');
  values.push(limit);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      ncode: number;
      vtrnno: string;
      party_name: string | null;
      pincode: string | null;
      city: string | null;
      state: string | null;
      lat: number | null;
      lng: number | null;
      complaint: string | null;
      item_name: string | null;
      call_type: string | null;
      status_label: string | null;
      engineer_name: string | null;
      branch_name: string | null;
      franchisee_name: string | null;
      logged_at: Date;
      solve_remarks: string | null;
    }>
  >(
    `
    SELECT
      h.ncode,
      h.vtrnno,
      h.party_name,
      h.pincode,
      h.city,
      h.state,
      h.lat,
      h.lng,
      h.complaint,
      h.item_name,
      h.call_type,
      h.status_label,
      h.engineer_name,
      h.branch_name,
      h.franchisee_name,
      h.logged_at,
      h.solve_remarks
    FROM calls_latest_hot h
    WHERE ${whereSql}
    ORDER BY h.logged_at DESC
    LIMIT $${idx}
    `,
    ...values
  );

  const syncMeta = await getSyncMeta();

  return {
    calls: rows.map((row) => ({
      id: row.ncode,
      ncode: row.ncode,
      UniqueCallNo: row.vtrnno,
      PartyName: row.party_name,
      Pincode: row.pincode,
      city: row.city,
      state: row.state,
      lat: row.lat,
      lng: row.lng,
      vcomplaint: row.complaint,
      itemname: row.item_name,
      calltype: row.call_type,
      Status: row.status_label,
      serviceman: row.engineer_name,
      officename: row.branch_name,
      franchisee_name: row.franchisee_name,
      callsdtrndate: row.logged_at,
      vsolveremarks: row.solve_remarks,
    })),
    syncMeta,
    readSource: 'postgres' as const,
  };
}
