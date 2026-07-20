import type ExcelJS from 'exceljs';
import { blobToPreparedExport, triggerBlobDownload } from '@/lib/report/summary-excel-export';
import { formatRegisterExportDate } from '@/lib/register/export-dates';
import { formatRegisterMajorMinor } from '@/lib/register/major-minor';
import { formatRegisterRepairDone } from '@/lib/register/format-repair-done';
import { isRegisterRowCancelled } from '@/lib/report/search';

/** Excel worksheet limit minus header row. */
const EXCEL_MAX_DATA_ROWS = 1_048_575;
/** Per-row styling is skipped above this count (faster + smaller file). */
const STYLE_ROW_LIMIT = 5_000;

const REGISTER_COLUMNS: { header: string; key: string; width: number }[] = [
  { header: 'ID', key: 'id', width: 15 },
  { header: 'Call Centre ID', key: 'vcclid', width: 15 },
  { header: 'Call Type', key: 'type', width: 15 },
  { header: 'Major / Minor', key: 'majorMinor', width: 12 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Customer', key: 'customer', width: 30 },
  { header: 'Branch', key: 'branch', width: 20 },
  { header: 'Region', key: 'region', width: 15 },
  { header: 'Account', key: 'account', width: 25 },
  { header: 'Franchisee', key: 'franchisee', width: 20 },
  { header: 'Pincode', key: 'pincode', width: 12 },
  { header: 'Product', key: 'product', width: 20 },
  { header: 'Serial', key: 'serial', width: 15 },
  { header: 'WCO', key: 'wco', width: 8 },
  { header: 'Technician', key: 'tech', width: 20 },
  { header: 'Complaint', key: 'complaint', width: 40 },
  { header: 'Repair done', key: 'repairDone', width: 22 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Solved Date', key: 'solvedDate', width: 12 },
  { header: 'Remarks', key: 'remarks', width: 30 },
  { header: 'Contact Person', key: 'contact', width: 20 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Address', key: 'address', width: 40 },
];

function formatExcelExportDate(dateStr: unknown): string {
  if (dateStr == null || dateStr === '') return '—';
  const formatted = formatRegisterExportDate(dateStr);
  return formatted || String(dateStr);
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
      majorMinor: formatRegisterMajorMinor(row),
      date: formatExcelExportDate(row.callsdtrndate),
      customer: row.PartyName,
      branch: row.officename ?? row.resolved_branch_name ?? '—',
      region: row.region ?? '—',
      account: row.account ?? '—',
      franchisee:
        row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '—',
      pincode: row.Pincode || '—',
      product: row.itemname,
      serial: row.callsvserialno,
      wco: row.WCO != null && String(row.WCO).trim() !== '' ? String(row.WCO).trim().toUpperCase() : '—',
      tech: row.serviceman,
      complaint: row.vcomplaint,
      repairDone: formatRegisterRepairDone(row.repair_done) || '—',
      status: statusText,
      solvedDate: isSolved ? formatExcelExportDate(row.callsolveddate) : '—',
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

export function detailedMisRegisterFilename(date = new Date()): string {
  return `WRL Detailed MIS Register — ${date.toISOString().split('T')[0]}.xlsx`;
}

export async function buildRegisterExcelWorkbook(
  rawRows: Record<string, unknown>[],
  opts?: Pick<RegisterExcelExportOptions, 'sheetName' | 'onProgress'>
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const rows = normalizeRegisterExportRows(rawRows);
  const workbook = new ExcelJSRuntime.Workbook();
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

export async function registerWorkbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function prepareRegisterExcelFromRows(
  rawRows: Record<string, unknown>[],
  opts?: RegisterExcelExportOptions
): Promise<import('@/lib/report/summary-excel-export').PreparedFileExport> {
  const rows = normalizeRegisterExportRows(rawRows);
  if (!rows.length) {
    throw new Error('No data to export');
  }

  const workbook = await buildRegisterExcelWorkbook(rows, opts);
  const buffer = await workbook.xlsx.writeBuffer();
  const baseName = opts?.filename ?? detailedMisRegisterFilename();
  const filename = baseName.endsWith('.xlsx') ? baseName : `${baseName}.xlsx`;
  return blobToPreparedExport(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

export async function downloadRegisterExcelFromRows(
  rawRows: Record<string, unknown>[],
  opts?: RegisterExcelExportOptions
): Promise<void> {
  const rows = normalizeRegisterExportRows(rawRows);
  if (!rows.length) {
    throw new Error('No data to export');
  }

  const prepared = await prepareRegisterExcelFromRows(rows, opts);
  await triggerBlobDownload(prepared.blob, prepared.filename, {
    objectUrl: prepared.objectUrl,
  });
}
