import { withBulkReadClient } from '@/lib/read-model/db';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';
import { escapeCsvCell } from '@/lib/utils/csv';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';
import type { DefectiveSerialsFilters } from '@/modules/defective-serials/server/query';
import { ensureDefectiveSerialsTable } from '@/modules/defective-serials/server/sync/postgres-sync';

const HEADERS = [
  'status',
  'vtrnno',
  'dtrndate',
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
  'branch_name',
  'ncalls',
  'nofficeid',
] as const;

const FETCH_SIZE = 5_000;
const EXPORT_CAP = 100_000;

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
              `(vtrnno ILIKE $${i} OR COALESCE(voldserialno,'') ILIKE $${i} OR COALESCE(party_name,'') ILIKE $${i} OR COALESCE(machine_serial,'') ILIKE $${i} OR COALESCE(defective_item_code,'') ILIKE $${i} OR COALESCE(return_by_name,'') ILIKE $${i})`
            );
          }
          const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

          if (!enqueue(encoder.encode(`${HEADERS.join(',')}\r\n`))) return;

          let exported = 0;
          let offset = 0;
          while (exported < EXPORT_CAP) {
            const limit = Math.min(FETCH_SIZE, EXPORT_CAP - exported);
            const qParams = [...params, limit, offset];
            const res = await client.query(
              `
              SELECT
                CASE WHEN COALESCE(breturntobranch, false) THEN 'done' ELSE 'pending' END AS status,
                vtrnno, dtrndate, party_name, client_name, model, machine_serial, city,
                call_centre_call_id, defective_item_code, defective_item_name, voldserialno,
                dreturntobranchdate, return_by_name, nreturntobranch, branch_name,
                ncalls, nofficeid
              FROM defective_serials
              ${whereSql}
              ORDER BY dtrndate DESC NULLS LAST, vtrnno DESC, ncode DESC
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
