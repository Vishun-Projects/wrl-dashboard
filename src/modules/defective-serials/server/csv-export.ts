import { withBulkReadClient } from '@/lib/read-model/db';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';
import { escapeCsvCell } from '@/lib/utils/csv';
import type { DefectiveSerialsFilters } from '@/modules/defective-serials/server/query';
import { ensureDefectiveSerialsTable } from '@/modules/defective-serials/server/sync/postgres-sync';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';

const HEADERS = [
  'status',
  'vtrnno',
  'dtrndate',
  'plant_code',
  'branch_name',
  'call_type',
  'vendor_code',
  'vendor_name',
  'party_name',
  'client_name',
  'model',
  'machine_serial',
  'city',
  'call_centre_call_id',
  'defective_item_code',
  'defective_item_name',
  'voldserialno',
  'dreturntobranchdate',
  'return_by_name',
  'nreturntobranch',
  'ncalls',
  'nofficeid',
] as const;

const FETCH_SIZE = 5_000;
const EXPORT_CAP = 100_000;

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

function buildExportWhere(filters: DefectiveSerialsFilters): {
  whereSql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters.status === 'pending') {
    where.push(`NOT COALESCE(d.breturntobranch, false)`);
  } else if (filters.status === 'done') {
    where.push(`COALESCE(d.breturntobranch, false)`);
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
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const i = params.length;
    where.push(
      `(d.vtrnno ILIKE $${i} OR COALESCE(d.voldserialno,'') ILIKE $${i} OR COALESCE(d.party_name,'') ILIKE $${i} OR COALESCE(d.machine_serial,'') ILIKE $${i} OR COALESCE(d.defective_item_code,'') ILIKE $${i} OR COALESCE(d.return_by_name,'') ILIKE $${i} OR COALESCE(${EFF_VENDOR_NAME},'') ILIKE $${i} OR COALESCE(${EFF_PLANT},'') ILIKE $${i})`
    );
  }
  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export async function buildDefectiveSerialsCsvStream(
  filters: DefectiveSerialsFilters
): Promise<Response> {
  const encoder = new TextEncoder();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `defective-serials-${filters.status}-${stamp}.csv`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const closed = () => controller.desiredSize === null;
      const enqueue = (bytes: Uint8Array): boolean => {
        if (closed()) return false;
        try {
          controller.enqueue(bytes);
          return true;
        } catch {
          return false;
        }
      };

      try {
        await withBulkReadClient(async (client) => {
          await ensureDefectiveSerialsTable(client);
          const { whereSql, params } = buildExportWhere(filters);

          if (!enqueue(encoder.encode(`${HEADERS.join(',')}\r\n`))) return;

          let exported = 0;
          let offset = 0;
          while (exported < EXPORT_CAP) {
            const limit = Math.min(FETCH_SIZE, EXPORT_CAP - exported);
            const qParams = [...params, limit, offset];
            const res = await client.query(
              `
              SELECT
                CASE WHEN COALESCE(d.breturntobranch, false) THEN 'done' ELSE 'pending' END AS status,
                d.vtrnno, d.dtrndate,
                ${EFF_PLANT} AS plant_code,
                ${EFF_BRANCH} AS branch_name,
                ${EFF_CALL_TYPE} AS call_type,
                ${EFF_VENDOR_CODE} AS vendor_code,
                ${EFF_VENDOR_NAME} AS vendor_name,
                d.party_name, d.client_name, d.model, d.machine_serial, d.city,
                d.call_centre_call_id, d.defective_item_code, d.defective_item_name, d.voldserialno,
                d.dreturntobranchdate, d.return_by_name, d.nreturntobranch,
                d.ncalls, d.nofficeid
              FROM defective_serials d
              ${HOT_DIMS_JOIN}
              ${whereSql}
              ORDER BY d.dtrndate DESC NULLS LAST, d.vtrnno DESC, d.ncode DESC
              LIMIT $${qParams.length - 1} OFFSET $${qParams.length}
              `,
              qParams
            );
            if (res.rows.length === 0) break;
            for (const row of res.rows) {
              const line = HEADERS.map((h) => {
                const v = (row as Record<string, unknown>)[h];
                if (v instanceof Date) return escapeCsvCell(v.toISOString());
                return escapeCsvCell(v == null ? '' : String(v));
              }).join(',');
              if (!enqueue(encoder.encode(`${line}\r\n`))) return;
              exported += 1;
            }
            offset += res.rows.length;
            if (res.rows.length < limit) break;
          }
        });
        if (!closed()) controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return responseForCsvStream(stream, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
}
