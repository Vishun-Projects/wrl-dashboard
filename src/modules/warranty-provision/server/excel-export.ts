import ExcelJS from 'exceljs';
import type { SnapResponse } from '@/modules/warranty-provision/server/snap';
import type { BreakdownMismatchResponse } from '@/modules/warranty-provision/server/breakdown-mfg';
import type { WarrantyForecastResponse } from '@/modules/warranty-provision/types';
import { UNITS_TEMPLATE_HEADERS } from '@/modules/warranty-provision/server/units-import';

export async function buildUnitsTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Units');
  ws.addRow([...UNITS_TEMPLATE_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    '1152190417',
    '2026-10-15',
    'MAT-001',
    'SN123456789',
    'AC',
    '',
    'Sample Customer',
    'Retail',
    'Ship To Name',
    'Maharashtra',
    'Mumbai',
    'INV-1',
    '2026-10-15',
    2190,
  ]);
  const notes = wb.addWorksheet('Notes');
  notes.addRow(['Field', 'Required', 'Notes']);
  notes.getRow(1).font = { bold: true };
  notes.addRow(['Billing Document', 'Yes', 'Upsert key with Serial Number']);
  notes.addRow(['Serial Number', 'Yes', 'Upsert key with Billing Document']);
  notes.addRow(['Warranty', 'Yes', 'Warranty start date (YYYY-MM-DD)']);
  notes.addRow(['Days', 'Yes', 'Warranty length in days; End = Start + Days']);
  notes.addRow(['Billing Date', 'No', 'Used for billing year / SNAP rows']);
  notes.addRow([
    'Ignored',
    '—',
    'Do not include Excel formula cols (End, Remaining, Status, End FY) — computed on import',
  ]);
  notes.addRow(['Format', '—', '.xlsx only (convert .xlsb → .xlsx if needed)']);
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  notes.columns.forEach((c) => {
    c.width = 28;
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Headers accepted by parseClaimsWorkbook (canonical names). */
export const CLAIMS_TEMPLATE_HEADERS = [
  'Serial Number',
  'Claim Date',
  'Claim No',
  'Defect Description',
  'Repair Cost',
  'Spare Parts Cost',
  'Labour Cost',
  'Traveling Reimbursement',
  'Total Cost',
] as const;

export async function buildClaimsTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Claims');
  ws.addRow([...CLAIMS_TEMPLATE_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    'ABC123456789',
    '2025-06-15',
    'CLM-0001',
    'Compressor failure',
    1200,
    3500,
    800,
    0,
    5500,
  ]);
  const notes = wb.addWorksheet('Notes');
  notes.addRow(['Field', 'Required', 'Notes']);
  notes.getRow(1).font = { bold: true };
  notes.addRow(['Serial Number', 'Yes', 'Matched to warranty unit serial']);
  notes.addRow(['Claim No', 'Yes', 'Unique; upserts on re-import']);
  notes.addRow(['Claim Date', 'No', 'YYYY-MM-DD; used for outside-warranty flag']);
  notes.addRow(['Defect Description', 'No', '']);
  notes.addRow(['Cost columns', 'No', 'If Total Cost blank, sum of component costs']);
  notes.addRow(['Aliases', '—', 'Job No = Claim No; Labor Cost = Labour Cost']);
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  notes.columns.forEach((c) => {
    c.width = 22;
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildSnapWorkbook(snap: SnapResponse): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SNAP Report');
  ws.addRow(['Billing year', ...snap.fys.map((f) => `FY ${f}`), 'FY Total Year']);
  ws.getRow(1).font = { bold: true };
  for (const r of snap.rows) {
    ws.addRow([r.year || 'Unknown', ...r.values.map((v) => Math.round(v)), Math.round(r.total)]);
  }
  const tot = ws.addRow([
    'Grand Total',
    ...snap.totals.map((v) => Math.round(v)),
    Math.round(snap.grandTotal),
  ]);
  tot.font = { bold: true };
  ws.eachRow((row) => {
    row.eachCell((cell, i) => {
      if (i > 1) cell.numFmt = '#,##,##0';
    });
  });
  ws.columns.forEach((c) => {
    c.width = 14;
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildMismatchWorkbook(
  data: BreakdownMismatchResponse
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mismatched');
  ws.addRow([
    'Only in',
    'Mfg year',
    'Serial',
    'TRN',
    'Party',
    'WCO',
    'Solved',
    'Status',
    'Warranty end',
  ]);
  ws.getRow(1).font = { bold: true };
  for (const r of data.rows) {
    ws.addRow([
      r.onlyIn,
      r.mfgYear || '',
      r.serial,
      r.trn,
      r.partyName,
      r.wco,
      r.solvedDay ?? '',
      r.statusBucket,
      r.warrantyEnd ?? '',
    ]);
  }
  ws.columns = [
    { width: 22 },
    { width: 10 },
    { width: 16 },
    { width: 14 },
    { width: 28 },
    { width: 8 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
  ];
  const notes = wb.addWorksheet('Summary');
  notes.addRow(['Item', 'Value']);
  notes.getRow(1).font = { bold: true };
  notes.addRow(['Period', data.periodYm]);
  notes.addRow(['As of', data.asOf]);
  notes.addRow(['Filter', data.onlyIn || 'All']);
  notes.addRow(['Rows in sheet', data.rows.length]);
  notes.addRow(['Warranty Provisioning only', data.wpOnlyCount]);
  notes.addRow(['CRM only', data.crmOnlyCount]);
  notes.columns.forEach((c) => {
    c.width = 28;
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildForecastWorkbook(
  forecast: WarrantyForecastResponse
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const values = wb.addWorksheet('Forecast');
  values.addRow(['Period', 'Expected claims', 'Cost', 'Cumulative cost']);
  values.getRow(1).font = { bold: true };
  for (const m of forecast.monthly) {
    values.addRow([m.period, m.expectedClaims, m.cost, m.cumulativeCost]);
  }
  values.addRow([]);
  values.addRow(['KPI', 'Value']);
  values.addRow(['Installed under warranty', forecast.kpis.installedUnderWarranty]);
  values.addRow(['Expected claims 12m', forecast.kpis.expectedClaims12m]);
  values.addRow(['Projected cost 12m', forecast.kpis.projectedCost12m]);
  values.addRow(['Projected cost 3y', forecast.kpis.projectedCost3y]);
  values.addRow(['Projected cost 5y', forecast.kpis.projectedCost5y]);
  values.addRow(['Provision required', forecast.provision.required]);
  values.addRow(['Existing provision', forecast.provision.existing]);
  values.addRow(['Provision gap', forecast.provision.gap]);

  const assumptions = wb.addWorksheet('Assumptions & formulas');
  assumptions.addRow(['Item', 'Detail']);
  assumptions.getRow(1).font = { bold: true };
  assumptions.addRow(['As-of', forecast.asOf]);
  assumptions.addRow(['Forecast start', forecast.forecastStart]);
  assumptions.addRow(['Scenario', forecast.scenario]);
  assumptions.addRow([
    'Coverage formula',
    'Days=0→0 else MAX(0,(MIN(End,FYEnd)-MAX(AsOf[,Start],FYStart))/(FYEnd-FYStart))',
  ]);
  assumptions.addRow(['Provision note', forecast.provision.note]);
  for (const line of forecast.methodology) assumptions.addRow(['Methodology', line]);
  for (const line of forecast.reconciliations) assumptions.addRow(['Check', line]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
