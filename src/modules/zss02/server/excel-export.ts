import type ExcelJS from 'exceljs';
import { branchFileLabel } from '@/modules/spare-loan-check/export-labels';
import type { Zss02Row } from '@/modules/zss02/types';

const HEADERS = [
  'Status',
  'Plant',
  'Vendor No.',
  'Vendor Name',
  'Item Group',
  'Material',
  'Material Description',
  'Barcode of Spare Part',
  'SO.No. (Con/Rtn)',
  'SO.No. (Loan)',
  'Loan Date',
  'Loan Rtn Date',
  'Cnsmp.Date',
  'No Cnsmp.Count',
  'Sale Date',
  'Sale Rtn Date',
] as const;

function statusLabel(row: Zss02Row): string {
  if (row.issue === 'cancelled') return row.issueDetail || 'Cancelled';
  if (row.issue === 'franchisee_change') return row.issueDetail || 'Franchisee changed';
  return '';
}

export function zss02RowToExportValues(row: Zss02Row): (string | number)[] {
  return [
    statusLabel(row),
    branchFileLabel(row.plant, row.plantName),
    row.vendorNo,
    row.vendorName,
    row.itemGroup ?? '',
    row.material,
    row.materialDescription,
    row.barcode,
    row.soConRtn,
    row.soLoan,
    row.loanDate,
    row.loanRtnDate,
    row.cnsmpDate,
    row.noCnsmpCount,
    row.saleDate,
    row.saleRtnDate,
  ];
}

export async function buildZss02Workbook(rows: Zss02Row[]): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet('ZSS02', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = HEADERS.map((header) => ({
    header,
    width: header.length < 10 ? 12 : Math.min(28, header.length + 4),
  }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };

  for (const row of rows) {
    const values = zss02RowToExportValues(row);
    const excelRow = sheet.addRow(values);
    // Barcode as text so Excel does not use scientific notation.
    excelRow.getCell(8).numFmt = '@';
  }

  return workbook;
}

export function zss02WorkbookFilename(asOn: string | null): string {
  const stamp = asOn?.replace(/[^\d]/g, '') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ZSS02_${stamp}.xlsx`;
}
