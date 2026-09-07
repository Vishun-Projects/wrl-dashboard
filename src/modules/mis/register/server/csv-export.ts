import { postQuery } from '@/lib/db/proxy';
import { REGISTER_EXPORT_COLUMNS } from '@/modules/mis/register/services/table-columns';
import { escapeCsvCell } from '@/lib/utils/csv';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';
import { registerRowToCsvLine } from '@/modules/mis/register/server/csv-export-browser';

export {
  rowForCsv,
  registerRowToCsvLine,
  buildRegisterCsvContent,
  prepareRegisterCsvExport,
  downloadRegisterCsvInBrowser,
} from '@/modules/mis/register/server/csv-export-browser';

const CSV_COLUMNS = REGISTER_EXPORT_COLUMNS;

export function createRegisterCsvResponse(
  rows: Record<string, unknown>[],
  filename?: string,
  _acceptEncoding?: string | null
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('\uFEFF'));
      controller.enqueue(
        encoder.encode(`${CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',')}\r\n`)
      );
      for (const row of rows) {
        controller.enqueue(encoder.encode(`${registerRowToCsvLine(row)}\r\n`));
      }
      controller.close();
    },
  });

  const resolvedName =
    filename ?? `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  return responseForCsvStream(stream, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${resolvedName}"`,
    'Cache-Control': 'no-store',
  });
}

export type RegisterCsvExportOpts = {
  fields: string;
  tableName: string;
  condition: string;
  batchSize?: number;
  knownTotal?: number;
  acceptEncoding?: string | null;
  processRows: (rows: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
  /** Server-only hooks — keep audit imports out of browser export-fetch. */
  onComplete?: (info: { filename: string; rowCount: number }) => void | Promise<void>;
  onFailure?: (info: {
    filename: string;
    rowCount: number;
    reason: 'error' | 'aborted';
    message?: string;
  }) => void | Promise<void>;
};

/** Stream register rows as CSV using keyset pagination on tc.ncode (avoids slow OFFSET). */
export async function buildRegisterCsvResponse(opts: RegisterCsvExportOpts): Promise<Response> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 1000, 1), 1000);
  const encoder = new TextEncoder();
  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;

  let fetched = 0;
  let finishedOk = false;
  let terminalLogged = false;

  const logTerminal = async (
    kind: 'complete' | 'aborted' | 'error',
    message?: string
  ) => {
    if (terminalLogged) return;
    terminalLogged = true;
    if (kind === 'complete') {
      await opts.onComplete?.({ filename, rowCount: fetched });
      return;
    }
    await opts.onFailure?.({
      filename,
      rowCount: fetched,
      reason: kind === 'aborted' ? 'aborted' : 'error',
      message,
    });
  };

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

      const headerLine = CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',') + '\r\n';
      if (!enqueue(encoder.encode(headerLine))) {
        await logTerminal('aborted');
        return;
      }

      const targetTotal = Math.max(0, opts.knownTotal ?? 0);

      try {
        let cursorNcode: number | null = null;
        while (!closed()) {
          let pageCondition = opts.condition;
          if (cursorNcode != null) {
            pageCondition += ` AND tc.ncode < ${cursorNcode}`;
          }

          const res = await postQuery({
            fields: opts.fields,
            tableName: opts.tableName,
            condition: pageCondition,
            orderBy: `tc.ncode DESC OFFSET 0 ROWS FETCH NEXT ${batchSize} ROWS ONLY`,
          });

          const rawRows = (res.data ?? []) as Record<string, unknown>[];
          if (!rawRows.length) break;

          const processed = await opts.processRows(rawRows);
          for (const raw of processed) {
            if (!enqueue(encoder.encode(`${registerRowToCsvLine(raw)}\r\n`))) {
              await logTerminal('aborted');
              return;
            }
          }

          fetched += processed.length;
          const lastNcode = Number(rawRows[rawRows.length - 1]?.id ?? rawRows[rawRows.length - 1]?.ncode);
          if (!Number.isFinite(lastNcode) || lastNcode <= 0) break;
          cursorNcode = lastNcode;

          if (targetTotal > 0 && fetched >= targetTotal) break;
          if (rawRows.length < batchSize) break;
        }

        if (closed() && !(targetTotal > 0 && fetched >= targetTotal) && fetched === 0) {
          await logTerminal('aborted');
          return;
        }

        finishedOk = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      } catch (err) {
        if (closed()) {
          await logTerminal('aborted');
          return;
        }
        await logTerminal(
          'error',
          err instanceof Error ? err.message : String(err)
        );
        try {
          controller.error(err);
        } catch {
          // already closed
        }
        return;
      } finally {
        if (finishedOk) {
          await logTerminal('complete');
        } else {
          await logTerminal('aborted');
        }
      }
    },
    async cancel() {
      await logTerminal('aborted');
    },
  });

  return responseForCsvStream(stream, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
}
