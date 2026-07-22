import 'server-only';

import { withBulkReadClient } from '@/lib/read-model/db';
import { formatRegisterExportDate } from '@/features/register/lib/export-dates';
import { formatRegisterMajorMinor } from '@/features/register/lib/major-minor';
import { formatRegisterRepairDone } from '@/features/register/lib/format-repair-done';
import {
  buildRegisterListQuery,
  buildWhere,
  countRegisterRowsFromPostgres,
  registerHotOrderBy,
  registerKeysetCursorFromRow,
  type RegisterPostgresParams,
} from '@/lib/read-model/queries/register';
import { REGISTER_EXPORT_HOT_COLUMNS } from '@/lib/read-model/queries/register-columns';
import { mergeArcpPickOntoHotExportRows } from '@/lib/register-sql/arcp-approve-dates-server';
import { enrichRegisterRowsRepairDone } from '@/lib/register-sql/repair-done-enrich';
import { escapeCsvCell } from '@/lib/utils/csv';
import { REGISTER_EXPORT_COLUMNS } from '@/features/register/lib/table-columns';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';

const KEYSET_FETCH_SIZE = 12_000;

function hotPgRowToRegisterCsvLine(row: Record<string, unknown>): string {
  const franchisee =
    row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '';
  const isCancelled =
    row.status_label === 'Cancel' ||
    (row.ncancelreason != null &&
      String(row.ncancelreason).trim() !== '' &&
      String(row.ncancelreason) !== '0' &&
      String(row.ncancelreason) !== '2');
  const isSolved =
    !isCancelled &&
    (row.status_label === 'Closed' ||
      row.status_label === 'Solved' ||
      String(row.bsolved).toLowerCase() === 'true' ||
      String(row.bsolved) === '1');
  const statusText = isCancelled
    ? 'Cancelled'
    : isSolved
      ? row.status_label === 'UNKNOWN'
        ? 'PENDING'
        : String(row.status_label || 'Solved')
      : String(row.status_label || 'OPEN');

  const bmAt = row.bm_approved_at;
  const hoAt = row.ho_approved_at;
  const bmDate =
    bmAt instanceof Date || (bmAt != null && bmAt !== '')
      ? formatRegisterExportDate(bmAt as Date | string)
      : '';
  const hoDate =
    hoAt instanceof Date || (hoAt != null && hoAt !== '')
      ? formatRegisterExportDate(hoAt as Date | string)
      : '';

  const cells: unknown[] = [
    row.vtrnno,
    row.vcclid ?? '',
    row.call_type,
    formatRegisterMajorMinor(row),
    formatRegisterExportDate(row.logged_at),
    row.party_name,
    row.branch_name,
    row.region,
    row.account,
    franchisee,
    row.pincode,
    row.item_name,
    row.serial,
    row.wco ?? '',
    row.engineer_name,
    row.complaint,
    formatRegisterRepairDone(row.repair_done),
    statusText,
    isSolved ? formatRegisterExportDate(row.solved_at) : '',
    bmDate,
    hoDate,
    row.solve_remarks || '',
    row.contact_person,
    row.phone,
    row.address,
  ];

  return cells.map(escapeCsvCell).join(',');
}

export type PostgresRegisterCsvStreamOptions = Omit<
  RegisterPostgresParams,
  'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'
> & { acceptEncoding?: string | null };

/** Stream register CSV from calls_latest_hot — composite keyset pages + batch ARCP enrichment per chunk. */
export async function buildPostgresRegisterCsvStream(
  params: PostgresRegisterCsvStreamOptions
): Promise<Response> {
  const { acceptEncoding, ...queryParams } = params;
  const fullParams: RegisterPostgresParams = {
    ...queryParams,
    page: 1,
    limit: KEYSET_FETCH_SIZE,
    fetchTotals: false,
    fetchFilterOptions: false,
  };

  const dbCount = await countRegisterRowsFromPostgres(fullParams);
  const encoder = new TextEncoder();

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
        if (!enqueue(encoder.encode('\uFEFF'))) return;
        if (
          !enqueue(
            encoder.encode(
              `${REGISTER_EXPORT_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',')}\r\n`
            )
          )
        ) {
          return;
        }

        let cursorLoggedAt: string | undefined;
        let cursorNcode: number | undefined;
        let exportedRows = 0;

        await withBulkReadClient(async (client) => {
          while (!closed()) {
            const pageParams: RegisterPostgresParams = {
              ...fullParams,
              cursorLoggedAt,
              cursorNcode,
            };
            const { sql: whereSql, values } = buildWhere(pageParams);
            const { text, values: queryValues } = buildRegisterListQuery(
              REGISTER_EXPORT_HOT_COLUMNS,
              whereSql,
              values,
              KEYSET_FETCH_SIZE,
              undefined,
              registerHotOrderBy(fullParams.dateFilterColumn)
            );

            const res = await client.query<Record<string, unknown>>({
              text,
              values: queryValues,
            });

            let rows = res.rows;
            if (!rows.length) break;

            rows = await mergeArcpPickOntoHotExportRows(rows, (sql, queryParams) =>
              client.query(sql, queryParams)
            );
            rows = await enrichRegisterRowsRepairDone(rows);

            let chunk = '';
            for (const row of rows) {
              chunk += `${hotPgRowToRegisterCsvLine(row)}\r\n`;
            }
            if (!enqueue(encoder.encode(chunk))) return;
            exportedRows += rows.length;

            const cursor = registerKeysetCursorFromRow(
              rows[rows.length - 1]!,
              fullParams.dateFilterColumn
            );
            if (!cursor) break;
            cursorLoggedAt = cursor.cursorLoggedAt;
            cursorNcode = cursor.cursorNcode;

            if (rows.length < KEYSET_FETCH_SIZE) break;
          }
        });

        if (closed()) return;

        if (exportedRows !== dbCount) {
          throw new Error(
            `Export incomplete — server exported ${exportedRows.toLocaleString()} of ${dbCount.toLocaleString()} rows`
          );
        }

        try {
          controller.close();
        } catch {
          // already closed (client abort)
        }
      } catch (err) {
        if (closed()) return;
        console.error('[register-export] CSV stream failed:', err);
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      }
    },
  });

  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Register-Export-Total': String(dbCount),
  };

  return responseForCsvStream(stream, headers, acceptEncoding);
}
