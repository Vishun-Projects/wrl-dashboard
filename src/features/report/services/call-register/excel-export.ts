import type ExcelJS from 'exceljs';
import { applySummaryHeaderStyle } from '@/features/report/services/summary-excel-export';
import type { CallRegisterSerialExportRow } from './shape';

const HEADERS = [
  'Client',
  'Serial Number',
  'Billing Date',
  'Deployment Date',
  'Installation Date',
  'Pending Deploy',
  'Pending Install',
] as const;

export async function buildCallRegisterSerialWorkbook(
  rows: CallRegisterSerialExportRow[]
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet('Serials', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { key: 'client', width: 24 },
    { key: 'serial', width: 20 },
    { key: 'qtyDate', width: 14 },
    { key: 'deploymentDate', width: 16 },
    { key: 'installationDate', width: 16 },
    { key: 'pendingDeploy', width: 14 },
    { key: 'pendingInstall', width: 14 },
  ];

  const header = sheet.addRow([...HEADERS]);
  applySummaryHeaderStyle(header);

  // Bulk add — far cheaper than addRow() per serial on large exports.
  if (rows.length) {
    sheet.addRows(
      rows.map((row) => [
        row.client,
        row.serial,
        row.qtyDate,
        row.deploymentDate,
        row.installationDate,
        row.pendingDeploy,
        row.pendingInstall,
      ])
    );
  }

  return workbook;
}
