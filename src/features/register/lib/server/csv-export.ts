import { postQuery } from '@/lib/db/proxy';
import { normalizeCrmCallRow } from '@/lib/call-row/normalize';
import { formatRegisterExportDate } from '@/features/register/lib/export-dates';
import { formatRegisterMajorMinor } from '@/features/register/lib/major-minor';
import { formatRegisterRepairDone } from '@/features/register/lib/format-repair-done';
import { REGISTER_EXPORT_COLUMNS } from '@/features/register/lib/table-columns';
import { escapeCsvCell } from '@/lib/utils/csv';
import {
  resolveUniqueDownloadFilename,
  triggerBlobDownload,
  blobToPreparedExport,
  type PreparedFileExport,
} from '@/features/report/download';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';

const CSV_COLUMNS = REGISTER_EXPORT_COLUMNS;

export function rowForCsv(raw: Record<string, unknown>): Record<string, unknown> {
  const row = normalizeCrmCallRow(raw);
  const branch = row.officename ?? row.resolved_branch_name ?? row.branch_office_name ?? '';
  const franchisee =
    row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '';
  const isCancelled =
    row.callstatus === 'Cancel' ||
    row.Status === 'Cancel' ||
    (row.ncancelreason != null &&
      String(row.ncancelreason).trim() !== '' &&
      String(row.ncancelreason) !== '0' &&
      String(row.ncancelreason) !== '2');
  const isSolved =
    !isCancelled &&
    (row.Status === 'Closed' ||
      row.callstatus === 'Solved' ||
      String(row.callsolved).toLowerCase() === 'true' ||
      String(row.callsolved) === '1');
  const statusText = isCancelled
    ? 'Cancelled'
    : isSolved
      ? row.Status === 'UNKNOWN'
        ? 'PENDING'
        : String(row.Status || row.callstatus || 'Solved')
      : String(row.Status || row.callstatus || 'OPEN');

  return {
    UniqueCallNo: row.UniqueCallNo,
    vcclid: row.vcclid ?? '',
    calltype: row.calltype,
    major_minor: formatRegisterMajorMinor(row),
    callsdtrndate: formatRegisterExportDate(row.callsdtrndate),
    PartyName: row.PartyName,
    officename: branch,
    region: row.region ?? '',
    account: row.account ?? '',
    franchisee_name: franchisee,
    Pincode: row.Pincode,
    itemname: row.itemname,
    callsvserialno: row.callsvserialno,
    WCO: row.WCO ?? '',
    serviceman: row.serviceman,
    vcomplaint: row.vcomplaint,
    repair_done: formatRegisterRepairDone(row.repair_done),
    display_status: statusText,
    solvedDate: isSolved ? formatRegisterExportDate(row.callsolveddate) : '',
    remarks: row.vsolveremarks || row.cancel_reason || '',
    bm_approved_date: formatRegisterExportDate(row.bm_approved_date) || '',
    ho_approved_date: formatRegisterExportDate(row.ho_approved_date) || '',
    vpersoncalling: row.vpersoncalling,
    vinsttel1: row.vinsttel1,
    vinstaddress: row.vinstaddress,
  };
}

export function registerRowToCsvLine(row: Record<string, unknown>): string {
  const mapped = rowForCsv(row);
  return CSV_COLUMNS.map((col) => escapeCsvCell(mapped[col.key as keyof typeof mapped])).join(',');
}

/** Build RFC4180-style CSV with CRLF line endings (Excel-friendly). */
export function buildRegisterCsvContent(rows: Record<string, unknown>[]): string {
  const lines = [CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(registerRowToCsvLine(row));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function createRegisterCsvResponse(
  rows: Record<string, unknown>[],
  filename?: string,
  acceptEncoding?: string | null
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
  return responseForCsvStream(
    stream,
    {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${resolvedName}"`,
      'Cache-Control': 'no-store',
    },
    acceptEncoding
  );
}

/** Build a register CSV blob for queued export (caller saves via user click when needed). */
export function prepareRegisterCsvExport(
  rows: Record<string, unknown>[],
  filename?: string
): PreparedFileExport {
  const csv = buildRegisterCsvContent(rows);
  const baseName =
    filename ?? `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  return blobToPreparedExport(
    new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }),
    baseName
  );
}

/** Trigger a register CSV download in the browser (UTF-8 BOM for Excel). */
export async function downloadRegisterCsvInBrowser(
  rows: Record<string, unknown>[],
  filename?: string
): Promise<void> {
  const prepared = prepareRegisterCsvExport(rows, filename);
  await triggerBlobDownload(prepared.blob, prepared.filename, {
    objectUrl: prepared.objectUrl,
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
};

/** Stream register rows as CSV using keyset pagination on tc.ncode (avoids slow OFFSET). */
export async function buildRegisterCsvResponse(opts: RegisterCsvExportOpts): Promise<Response> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 1000, 1), 1000);
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

      const headerLine = CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',') + '\r\n';
      if (!enqueue(encoder.encode(headerLine))) return;

      let cursorNcode: number | null = null;
      let fetched = 0;
      const targetTotal = Math.max(0, opts.knownTotal ?? 0);

      try {
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
            if (!enqueue(encoder.encode(`${registerRowToCsvLine(raw)}\r\n`))) return;
          }

          fetched += processed.length;
          const lastNcode = Number(rawRows[rawRows.length - 1]?.id ?? rawRows[rawRows.length - 1]?.ncode);
          if (!Number.isFinite(lastNcode) || lastNcode <= 0) break;
          cursorNcode = lastNcode;

          if (targetTotal > 0 && fetched >= targetTotal) break;
          if (rawRows.length < batchSize) break;
        }

        if (closed()) return;
        try {
          controller.close();
        } catch {
          // already closed
        }
      } catch (err) {
        if (closed()) return;
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      }
    },
  });

  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  return responseForCsvStream(
    stream,
    {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
    opts.acceptEncoding
  );
}
