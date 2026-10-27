import { withBulkReadClient } from '@/lib/read-model/db';
import { responseForCsvStream, csvDownloadHeaders } from '@/lib/net/csv-gzip-response';
import { escapeCsvCell } from '@/lib/utils/csv';
import { formatUiDate } from '@/lib/dates/ui-date';
import {
  buildCallPartsFilterSql,
  CALL_PARTS_CATEGORY,
  CALL_PARTS_CATEGORY_JOIN,
  CALL_PARTS_FROM,
  CALL_PARTS_HOT_COLS,
  matchesSapDocFilter,
  sapDocOuterSql,
} from '@/sql/call-visits/query';
import { sapBaseSql, type CallPartsFilters } from '@/modules/call-visits/server/query';
import {
  daysDiffTechSolveCons,
  getCachedSapDocLookup,
  hasSapBarcodeMismatch,
  type SapDocPair,
} from '@/modules/call-visits/server/sap-doc';

const FETCH_SIZE = 5_000;
/** ponytail: one HTTP export stops at 500k rows. */
const EXPORT_CAP = 500_000;

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
  'Part category',
  'Part code',
  'SAP doc',
  'Part',
  'Qty',
  'New barcode',
  'Days Diff (Cons in SAP - techSolve)',
  'SAP doc (Defective)',
  'Defective qty',
  'SAP doc (Defective Receipt)',
  'Defc Recpt Qty',
  'Old barcode',
  'Remarks',
];

type CsvDbRow = {
  ncode: string;
  nofficeid: string;
  call_no: string | null;
  visit_no: string | null;
  visit_at: string | Date | null;
  part_category: string | null;
  part_code: string | null;
  part_name: string | null;
  franchisee_code: string | null;
  sap_doc_defective?: string | null;
  sap_doc_defective_qty?: number | string | null;
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

function formatSapQty(value: number | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(n);
}

function sapDocCell(docs: string | null, barcode: string | null): string | null {
  if (!docs && !barcode) return null;
  if (!barcode) return docs;
  if (!docs) return `SAP Barcode: ${barcode}`;
  return `${docs} | SAP Barcode: ${barcode}`;
}

function visitYmd(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return String(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function line(row: CsvDbRow, sap: SapDocPair): string {
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
    row.part_category,
    row.part_code,
    sapDocCell(sap.sapDoc, sap.sapDocBarcode),
    row.part_name,
    row.qty,
    row.new_barcode,
    daysDiffTechSolveCons(visitYmd(row.visit_at), sap.sapDocPostingDate),
    sapDocCell(sap.sapDocDefective, sap.sapDocDefectiveBarcode),
    sap.sapDocDefectiveQty,
    sapDocCell(sap.sapDocDefectiveReceipt, sap.sapDocDefectiveReceiptBarcode),
    sap.sapDocDefectiveReceiptQty,
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
  const sapDefFilter = Boolean(filters.sapDocDefective.trim());
  const jsSapFilter =
    Boolean(filters.sapDoc.trim()) ||
    Boolean(filters.sapDocReceipt.trim()) ||
    filters.barcodeMismatch;

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

        await withBulkReadClient(async (client) => {
          const lookup = await getCachedSapDocLookup(client);

          const cursorParams = [...params];
          const sapOuter = sapDefFilter ? sapDocOuterSql(filters.sapDocDefective, cursorParams) : '';
          const cursorSql = sapDefFilter
            ? `${sapBaseSql(where)}
               SELECT ncode, nofficeid, call_no, visit_no, visit_at, part_category,
                      part_code, part_name, qty, old_barcode, new_barcode, remarks, franchisee_code,
                      call_logged_at, barcode, machine_name, model_code, plant_name, branch_name,
                      client_name, party_name, city, status_label, engineer_name,
                      sap_doc_defective, sap_doc_defective_qty
               FROM base
               WHERE ${sapOuter || 'TRUE'}
               ORDER BY ncode, nofficeid`
            : `SELECT p.ncode, p.nofficeid, p.call_no, p.visit_no, p.visit_at,
                      ${CALL_PARTS_CATEGORY} AS part_category,
                      p.part_code, p.part_name, p.qty,
                      p.old_barcode, p.new_barcode, p.remarks,
                      NULLIF(btrim(h.franchisee_code), '') AS franchisee_code,
                      ${CALL_PARTS_HOT_COLS}
               ${CALL_PARTS_FROM}
               ${CALL_PARTS_CATEGORY_JOIN}
               WHERE ${where}
               ORDER BY p.ncode, p.nofficeid`;

          await client.query('BEGIN');
          try {
            await client.query(
              `DECLARE call_parts_csv NO SCROLL CURSOR FOR ${cursorSql}`,
              cursorParams
            );

            while (!closed() && exported < EXPORT_CAP) {
              const limit = jsSapFilter
                ? FETCH_SIZE
                : Math.min(FETCH_SIZE, EXPORT_CAP - exported);
              const res = await client.query<CsvDbRow>(`FETCH ${limit} FROM call_parts_csv`);
              if (res.rows.length === 0) break;

              const lines: string[] = [];
              for (const row of res.rows) {
                const matched = lookup.match({
                  callNo: row.call_no,
                  plantName: row.plant_name,
                  franchiseeCode: row.franchisee_code,
                  partCategory: row.part_category,
                  partCode: row.part_code,
                  newBarcode: row.new_barcode,
                  oldBarcode: row.old_barcode,
                });
                const sap: SapDocPair = {
                  ...matched,
                  sapDocDefective: sapDefFilter
                    ? (row.sap_doc_defective ?? null)
                    : matched.sapDocDefective,
                  sapDocDefectiveQty: sapDefFilter
                    ? formatSapQty(row.sap_doc_defective_qty)
                    : matched.sapDocDefectiveQty,
                };
                if (filters.barcodeMismatch && !hasSapBarcodeMismatch(sap)) continue;
                if (!matchesSapDocFilter(sap.sapDoc, filters.sapDoc)) continue;
                if (!matchesSapDocFilter(sap.sapDocDefectiveReceipt, filters.sapDocReceipt)) continue;
                lines.push(line(row, sap));
              }
              if (lines.length > 0 && !enqueue(encoder.encode(`${lines.join('\r\n')}\r\n`))) break;
              exported += jsSapFilter ? lines.length : res.rows.length;
              if (res.rows.length < limit) break;
            }

            await client.query('CLOSE call_parts_csv');
            await client.query('COMMIT');
          } catch (err) {
            try {
              await client.query('ROLLBACK');
            } catch {
              /* ignore */
            }
            throw err;
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
