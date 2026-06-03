import ExcelJS from 'exceljs';
import { isRegisterRowCancelled } from '@/lib/report/search';

/** Excel worksheet limit minus header row. */
const EXCEL_MAX_DATA_ROWS = 1_048_575;
/** Per-row styling is skipped above this count (faster + smaller file). */
const STYLE_ROW_LIMIT = 5_000;

const REGISTER_COLUMNS: { header: string; key: string; width: number }[] = [
  { header: 'ID', key: 'id', width: 15 },
  { header: 'Call Centre ID', key: 'vcclid', width: 15 },
  { header: 'Call Type', key: 'type', width: 15 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Customer', key: 'customer', width: 30 },
  { header: 'Branch', key: 'branch', width: 20 },
  { header: 'Franchisee', key: 'franchisee', width: 20 },
  { header: 'Pincode', key: 'pincode', width: 12 },
  { header: 'Product', key: 'product', width: 20 },
  { header: 'Serial', key: 'serial', width: 15 },
  { header: 'Technician', key: 'tech', width: 20 },
  { header: 'Complaint', key: 'complaint', width: 40 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Solved Date', key: 'solvedDate', width: 12 },
  { header: 'Remarks', key: 'remarks', width: 30 },
  { header: 'Contact Person', key: 'contact', width: 20 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Address', key: 'address', width: 40 },
];

function formatExportDate(dateStr: unknown): string {
  if (dateStr == null || dateStr === '') return '—';
  const d = new Date(String(dateStr));
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
}

function mapRegisterRow(row: Record<string, unknown>) {
  const isCancelled = isRegisterRowCancelled(row);
  const isSolved =
    !isCancelled &&
    (row.Status === 'Closed' ||
      row.callstatus === 'Solved' ||
      String(row.callsolved).toLowerCase() === 'true' ||
      String(row.callsolved) === '1');
  const isAssigned =
    !isCancelled &&
    !isSolved &&
    (row.Status === 'Assigned' || row.callstatus === 'Assigned');
  const statusText = isCancelled
    ? 'Cancelled'
    : row.Status === 'UNKNOWN'
      ? 'PENDING'
      : String(row.Status || row.callstatus || 'OPEN');

  return {
    values: {
      id: row.UniqueCallNo,
      vcclid: row.vcclid ?? '—',
      type: row.calltype,
      date: formatExportDate(row.callsdtrndate),
      customer: row.PartyName,
      branch: row.officename ?? row.resolved_branch_name ?? '—',
      franchisee:
        row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '—',
      pincode: row.Pincode || '—',
      product: row.itemname,
      serial: row.callsvserialno,
      tech: row.serviceman,
      complaint: row.vcomplaint,
      status: statusText,
      solvedDate: isSolved ? formatExportDate(row.callsolveddate) : '—',
      remarks: row.vsolveremarks || row.cancel_reason || '—',
      contact: row.vpersoncalling,
      phone: row.vinsttel1,
      address: row.vinstaddress,
    },
    isCancelled,
    isSolved,
    isAssigned,
  };
}

/** Guard against accidentally passing an API payload `{ data: [...] }`. */
function normalizeRegisterExportRows(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
  }
  if (input && typeof input === 'object' && 'data' in input) {
    const nested = (input as { data?: unknown }).data;
    if (Array.isArray(nested)) {
      return nested.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
    }
  }
  return [];
}

type RegisterExcelExportOptions = {
  filename?: string;
  sheetName?: string;
  onProgress?: (processed: number, total: number) => void;
};

async function buildRegisterExcelWorkbook(
  rawRows: Record<string, unknown>[],
  opts?: Pick<RegisterExcelExportOptions, 'sheetName' | 'onProgress'>
): Promise<ExcelJS.Workbook> {
  const rows = normalizeRegisterExportRows(rawRows);
  const workbook = new ExcelJS.Workbook();
  const styleRows = rows.length <= STYLE_ROW_LIMIT;
  const chunkCount = Math.max(1, Math.ceil(rows.length / EXCEL_MAX_DATA_ROWS));

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const start = chunkIndex * EXCEL_MAX_DATA_ROWS;
    const chunk = rows.slice(start, start + EXCEL_MAX_DATA_ROWS);
    const sheetLabel =
      chunkCount === 1
        ? opts?.sheetName ?? 'Call Register'
        : `${opts?.sheetName ?? 'Call Register'} ${chunkIndex + 1}`;
    const sheet = workbook.addWorksheet(sheetLabel.slice(0, 31));
    sheet.columns = REGISTER_COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));
    applyHeaderStyle(sheet.getRow(1));

    let processed = start;
    for (const row of chunk) {
      const mapped = mapRegisterRow(row);
      const excelRow = sheet.addRow(mapped.values);
      if (styleRows) {
        const statusCell = excelRow.getCell('status');
        statusCell.font = {
          bold: true,
          color: {
            argb: mapped.isCancelled
              ? 'FFDC2626'
              : mapped.isSolved
                ? 'FF059669'
                : mapped.isAssigned
                  ? 'FF1D4ED8'
                  : 'FF64748B',
          },
        };
        if (mapped.isSolved || mapped.isAssigned) {
          statusCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: mapped.isSolved ? 'FFF8FAFC' : 'FFE8F0FE' },
          };
        }
      }
      processed += 1;
      if (processed % 500 === 0 || processed === rows.length) {
        opts?.onProgress?.(processed, rows.length);
      }
    }
  }

  return workbook;
}

export async function downloadRegisterExcelFromRows(
  rawRows: Record<string, unknown>[],
  opts?: RegisterExcelExportOptions
): Promise<void> {
  const rows = normalizeRegisterExportRows(rawRows);
  if (!rows.length) {
    throw new Error('No data to export');
  }

  const workbook = await buildRegisterExcelWorkbook(rows, opts);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename =
    opts?.filename ?? `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.xlsx`;

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
