import 'server-only';

import {
  appDatabaseBulkStatementTimeoutMs,
  withAppClient,
} from '@/lib/read-model/db';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import {
  buildWhere,
  type RegisterPostgresParams,
} from '@/lib/read-model/queries/register';
import { REGISTER_EXPORT_HOT_COLUMNS } from '@/lib/read-model/queries/register-columns';
import { csvEscape } from '@/lib/register/server/csv-export';
import { REGISTER_EXPORT_COLUMNS } from '@/lib/register/table-columns';

const CURSOR_FETCH_SIZE = 12_000;

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
  const bmDate =
    bmAt instanceof Date || (bmAt != null && bmAt !== '')
      ? formatArcpClaimsExportDate(bmAt as Date | string)
      : '';

  const cells: unknown[] = [
    row.vtrnno,
    row.vcclid ?? '',
    row.call_type,
    row.logged_at,
    row.party_name,
    row.branch_name,
    franchisee,
    row.pincode,
    row.item_name,
    row.serial,
    row.engineer_name,
    row.complaint,
    statusText,
    isSolved ? row.solved_at : '',
    bmDate,
    '',
    row.solve_remarks || '',
    row.contact_person,
    row.phone,
    row.address,
  ];

  return cells.map(csvEscape).join(',');
}

export type PostgresRegisterCsvStreamOptions = Omit<
  RegisterPostgresParams,
  'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'
> & {
  knownTotal?: number;
};

/** Stream register CSV from calls_latest_hot — single cursor, no per-batch enrichment. */
export async function buildPostgresRegisterCsvStream(
  params: PostgresRegisterCsvStreamOptions
): Promise<Response> {
  const { knownTotal, ...filterParams } = params;
  const fullParams: RegisterPostgresParams = {
    ...filterParams,
    page: 1,
    limit: 1,
    fetchTotals: false,
    fetchFilterOptions: false,
  };
  const { sql: whereSql, values } = buildWhere(fullParams);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode('\uFEFF'));
        controller.enqueue(
          encoder.encode(
            `${REGISTER_EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(',')}\r\n`
          )
        );

        await withAppClient(
          async (client) => {
            await client.query('BEGIN');
            try {
              await client.query(
                {
                  text: `
                    DECLARE register_export CURSOR FOR
                    SELECT ${REGISTER_EXPORT_HOT_COLUMNS}
                    FROM calls_latest_hot h
                    WHERE ${whereSql}
                    ORDER BY h.ncode DESC`,
                  values,
                }
              );

              while (true) {
                const res = await client.query(
                  `FETCH FORWARD ${CURSOR_FETCH_SIZE} FROM register_export`
                );
                const rows = res.rows as Record<string, unknown>[];
                if (!rows.length) break;

                let chunk = '';
                for (const row of rows) {
                  chunk += `${hotPgRowToRegisterCsvLine(row)}\r\n`;
                }
                controller.enqueue(encoder.encode(chunk));

                if (rows.length < CURSOR_FETCH_SIZE) break;
              }

              await client.query('CLOSE register_export');
              await client.query('COMMIT');
            } catch (err) {
              await client.query('ROLLBACK').catch(() => undefined);
              throw err;
            }
          },
          { statementTimeoutMs: appDatabaseBulkStatementTimeoutMs() }
        );

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  };
  if (knownTotal != null && knownTotal > 0) {
    headers['X-Register-Export-Total'] = String(knownTotal);
  }

  return new Response(stream, { headers });
}
