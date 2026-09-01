import { withBulkReadClient } from '@/lib/read-model/db';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';
import { escapeCsvCell } from '@/lib/utils/csv';
import type { CancelledCallsFilters } from '@/modules/cancelled-calls/types';
import {
  buildCancelledCallsFilterSql,
  countCancelledCalls,
} from '@/modules/cancelled-calls/server/query';
import {
  CANCELLED_CALLS_CSV_HEADERS,
  cancelledCallDbRowToCsvLine,
  type CancelledCallCsvDbRow,
} from '@/modules/cancelled-calls/server/csv';

const KEYSET_FETCH_SIZE = 5_000;
const EXPORT_ROW_CAP = 50_000;

const EXPORT_SELECT = `
  c.vtrnno,
  c.logged_at,
  c.cancelled_at,
  c.branch_name,
  c.franchisee_name,
  c.franchisee_vendor_code,
  c.party_name,
  c.account,
  c.call_type,
  c.item_code,
  c.serial,
  c.complaint,
  c.cancel_reason,
  c.ncancelreason,
  c.region
`;

/** Stream cancelled-calls CSV from Postgres — no CRM item-code enrichment on export. */
export async function buildCancelledCallsCsvStream(
  filters: CancelledCallsFilters
): Promise<Response> {
  const { where, params } = buildCancelledCallsFilterSql(filters);
  const exportTotal = Math.min(await countCancelledCalls(filters), EXPORT_ROW_CAP);
  const encoder = new TextEncoder();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `cancelled-calls-${stamp}.csv`;

  let exportedRows = 0;

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
              `${CANCELLED_CALLS_CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',')}\r\n`
            )
          )
        ) {
          return;
        }

        let cursorCancelledAt: Date | null = null;
        let cursorVtrnno: string | null = null;

        await withBulkReadClient(async (client) => {
          while (!closed() && exportedRows < exportTotal) {
            const pageLimit = Math.min(KEYSET_FETCH_SIZE, exportTotal - exportedRows);
            const pageParams = [...params];
            let keysetClause = '';
            if (cursorCancelledAt != null && cursorVtrnno != null) {
              pageParams.push(cursorCancelledAt, cursorVtrnno);
              const atIdx = pageParams.length - 1;
              const trnIdx = pageParams.length;
              keysetClause = `AND (c.cancelled_at, c.vtrnno) < ($${atIdx}::timestamptz, $${trnIdx}::text)`;
            }
            pageParams.push(pageLimit);

            const res = await client.query<CancelledCallCsvDbRow>(
              `
              SELECT ${EXPORT_SELECT}
              FROM public.calls_cancelled c
              WHERE ${where}
                ${keysetClause}
              ORDER BY c.cancelled_at DESC, c.vtrnno DESC
              LIMIT $${pageParams.length}
              `,
              pageParams
            );

            const rows = res.rows;
            if (!rows.length) break;

            const lines = new Array<string>(rows.length);
            for (let i = 0; i < rows.length; i++) {
              lines[i] = cancelledCallDbRowToCsvLine(rows[i]!);
            }
            if (!enqueue(encoder.encode(`${lines.join('\r\n')}\r\n`))) return;

            exportedRows += rows.length;
            const last = rows[rows.length - 1]!;
            cursorCancelledAt =
              last.cancelled_at instanceof Date
                ? last.cancelled_at
                : new Date(String(last.cancelled_at));
            cursorVtrnno = String(last.vtrnno);

            if (rows.length < pageLimit) break;
          }
        });

        if (!closed()) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      } catch (err) {
        if (closed()) return;
        console.error('[cancelled-calls] CSV stream failed:', err);
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      }
    },
  });

  return responseForCsvStream(stream, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Cancelled-Export-Total': String(exportTotal),
  });
}
