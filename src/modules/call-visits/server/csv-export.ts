import { withBulkReadClient } from '@/lib/read-model/db';
import { responseForCsvStream, csvDownloadHeaders } from '@/lib/net/csv-gzip-response';
import { escapeCsvCell } from '@/lib/utils/csv';
import { formatUiDate } from '@/lib/dates/ui-date';
import { buildCallPartsFilterSql, CALL_PARTS_FROM, CALL_PARTS_HOT_COLS } from '@/sql/call-visits/query';
import type { CallPartsFilters } from '@/modules/call-visits/server/query';

const PAGE = 2_000;
/** ponytail: one HTTP export stops at 200k rows. Raise this if an all-time download must be larger. */
const EXPORT_CAP = 200_000;

const HEADERS = [
  'Call no',
  'Call date',
  'Visit no',
  'Visit date',
  'Branch',
  'Franchisee',
  'Client',
  'Customer',
  'City',
  'Status',
  'Engineer',
  'Model',
  'Description',
  'M/C Serial no.',
  'Part code',
  'Part',
  'Qty',
  'New barcode',
  'Old barcode',
  'Remarks',
];

type CsvDbRow = {
  ncode: string;
  nofficeid: string;
  call_no: string | null;
  visit_no: string | null;
  visit_at: string | Date | null;
  part_code: string | null;
  part_name: string | null;
  qty: string | null;
  old_barcode: string | null;
  new_barcode: string | null;
  remarks: string | null;
  call_logged_at: Date | string | null;
  barcode: string | null;
  machine_name: string | null;
  model_code: string | null;
  plant_name: string | null;
  branch_name: string | null;
  client_name: string | null;
  party_name: string | null;
  city: string | null;
  status_label: string | null;
  engineer_name: string | null;
};

function line(row: CsvDbRow): string {
  return [
    row.call_no,
    formatUiDate(row.call_logged_at),
    row.visit_no,
    formatUiDate(row.visit_at),
    row.plant_name,
    row.branch_name,
    row.client_name,
    row.party_name,
    row.city,
    row.status_label,
    row.engineer_name,
    row.model_code,
    row.machine_name,
    row.barcode,
    row.part_code,
    row.part_name,
    row.qty,
    row.new_barcode,
    row.old_barcode,
    row.remarks,
  ]
    .map((cell) => escapeCsvCell(cell))
    .join(',');
}

export function buildCallPartsCsvStream(filters: CallPartsFilters): Response {
  const { where, params } = buildCallPartsFilterSql(filters);
  const encoder = new TextEncoder();
  const stamp = new Date().toISOString().slice(0, 10);
  let exported = 0;

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
        if (!enqueue(encoder.encode(`${HEADERS.map((h) => escapeCsvCell(h)).join(',')}\r\n`))) return;
        let cursorNcode: string | null = null;
        let cursorOffice: string | null = null;

        await withBulkReadClient(async (client) => {
          while (!closed() && exported < EXPORT_CAP) {
            const limit = Math.min(PAGE, EXPORT_CAP - exported);
            const pageParams = [...params];
            let keyset = '';
            if (cursorNcode && cursorOffice) {
              pageParams.push(cursorNcode, cursorOffice);
              const ncode = pageParams.length - 1;
              const office = pageParams.length;
              keyset = `AND (p.ncode, p.nofficeid) > ($${ncode}::text, $${office}::text)`;
            }
            pageParams.push(limit);
            const res = await client.query<CsvDbRow>(
              `SELECT p.ncode, p.nofficeid, p.call_no, p.visit_no, p.visit_at, p.part_code, p.part_name, p.qty,
                      p.old_barcode, p.new_barcode, p.remarks,
                      ${CALL_PARTS_HOT_COLS}
               ${CALL_PARTS_FROM}
               WHERE ${where}
               ${keyset}
               ORDER BY p.ncode, p.nofficeid
               LIMIT $${pageParams.length}`,
              pageParams
            );
            if (res.rows.length === 0) break;
            if (!enqueue(encoder.encode(`${res.rows.map(line).join('\r\n')}\r\n`))) return;
            exported += res.rows.length;
            const last = res.rows[res.rows.length - 1]!;
            cursorNcode = last.ncode;
            cursorOffice = last.nofficeid;
            if (res.rows.length < limit) break;
          }
        });
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return responseForCsvStream(stream, csvDownloadHeaders({ fileName: `call-parts-${stamp}.csv`, gzip: false }));
}
