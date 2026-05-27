import { postQuery } from '@/lib/db-proxy';

const CSV_COLUMNS: { key: string; header: string }[] = [
  { key: 'UniqueCallNo', header: 'ID' },
  { key: 'vcclid', header: 'Call Centre ID' },
  { key: 'calltype', header: 'Call Type' },
  { key: 'callsdtrndate', header: 'Date' },
  { key: 'PartyName', header: 'Customer' },
  { key: 'officename', header: 'Branch' },
  { key: 'franchisee_name', header: 'Franchisee' },
  { key: 'Pincode', header: 'Pincode' },
  { key: 'itemname', header: 'Product' },
  { key: 'callsvserialno', header: 'Serial' },
  { key: 'serviceman', header: 'Technician' },
  { key: 'vcomplaint', header: 'Complaint' },
  { key: 'display_status', header: 'Status' },
  { key: 'solvedDate', header: 'Solved Date' },
  { key: 'remarks', header: 'Remarks' },
  { key: 'vpersoncalling', header: 'Contact Person' },
  { key: 'vinsttel1', header: 'Phone' },
  { key: 'vinstaddress', header: 'Address' },
];

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowForCsv(row: Record<string, unknown>): Record<string, unknown> {
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
    callsdtrndate: row.callsdtrndate,
    PartyName: row.PartyName,
    officename: branch,
    franchisee_name: franchisee,
    Pincode: row.Pincode,
    itemname: row.itemname,
    callsvserialno: row.callsvserialno,
    serviceman: row.serviceman,
    vcomplaint: row.vcomplaint,
    display_status: statusText,
    solvedDate: isSolved ? row.callsolveddate : '',
    remarks: row.vsolveremarks || row.cancel_reason || '',
    vpersoncalling: row.vpersoncalling,
    vinsttel1: row.vinsttel1,
    vinstaddress: row.vinstaddress,
  };
}

export type RegisterCsvExportOpts = {
  fields: string;
  tableName: string;
  condition: string;
  batchSize?: number;
  knownTotal?: number;
  processRows: (rows: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
};

/** Stream register rows as CSV using keyset pagination on tc.ncode (avoids slow OFFSET). */
export async function buildRegisterCsvResponse(opts: RegisterCsvExportOpts): Promise<Response> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 1000, 1), 1000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const headerLine = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',') + '\r\n';
      controller.enqueue(encoder.encode(headerLine));

      let cursorNcode: number | null = null;
      let fetched = 0;
      const targetTotal = Math.max(0, opts.knownTotal ?? 0);

      try {
        while (true) {
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
            const row = rowForCsv(raw);
            const line =
              CSV_COLUMNS.map((col) => csvEscape(row[col.key as keyof typeof row])).join(',') +
              '\r\n';
            controller.enqueue(encoder.encode(line));
          }

          fetched += processed.length;
          const lastNcode = Number(rawRows[rawRows.length - 1]?.id ?? rawRows[rawRows.length - 1]?.ncode);
          if (!Number.isFinite(lastNcode) || lastNcode <= 0) break;
          cursorNcode = lastNcode;

          if (targetTotal > 0 && fetched >= targetTotal) break;
          if (rawRows.length < batchSize) break;
        }

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
