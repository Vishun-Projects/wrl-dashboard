import 'server-only';

import {
  appDatabaseBulkStatementTimeoutMs,
  withAppClient,
} from '@/lib/read-model/db';
import {
  buildWhere,
  type RegisterPostgresParams,
} from '@/lib/read-model/queries/register';
import { REGISTER_HOT_COLUMNS } from '@/lib/read-model/queries/register-columns';
import { mergeArcpApproveDatesFromHot } from '@/lib/register/arcp-approve-dates-server';
import { mergeAuditEnrichment } from '@/lib/register/audit-enrichment';
import {
  csvEscape,
  registerRowToCsvLine,
} from '@/lib/register/server/csv-export';
import { REGISTER_EXPORT_COLUMNS } from '@/lib/register/table-columns';
import { hotRowToRegisterRow } from '@/lib/read-model/queries/register';

const CSV_BATCH_SIZE = 2000;

/** Stream register CSV from calls_latest_hot (keyset on ncode — no CRM). */
export async function buildPostgresRegisterCsvStream(
  params: Omit<RegisterPostgresParams, 'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'>
): Promise<Response> {
  const fullParams: RegisterPostgresParams = {
    ...params,
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
            let cursorNcode: number | null = null;

            while (true) {
              const qValues: unknown[] = [...values];
              let sql = `
                SELECT ${REGISTER_HOT_COLUMNS}
                FROM calls_latest_hot h
                WHERE ${whereSql}`;

              if (cursorNcode != null) {
                sql += ` AND h.ncode < $${qValues.length + 1}`;
                qValues.push(cursorNcode);
              }

              sql += ` ORDER BY h.ncode DESC LIMIT $${qValues.length + 1}`;
              qValues.push(CSV_BATCH_SIZE);

              const res = await client.query(sql, qValues);
              const rows = res.rows as Record<string, unknown>[];
              if (!rows.length) break;

              const mapped = (await mergeArcpApproveDatesFromHot(
                rows.map(hotRowToRegisterRow)
              )) as Record<string, unknown>[];
              const enriched = await mergeAuditEnrichment(mapped);

              for (const row of enriched) {
                controller.enqueue(encoder.encode(`${registerRowToCsvLine(row)}\r\n`));
              }

              const lastNcode = Number(rows[rows.length - 1]?.ncode);
              if (!Number.isFinite(lastNcode) || lastNcode <= 0) break;
              cursorNcode = lastNcode;

              if (rows.length < CSV_BATCH_SIZE) break;
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
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
