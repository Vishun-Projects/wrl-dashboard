import type ExcelJS from 'exceljs';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/report/summary-derive';

export function getRegionColor(region: string): string {
  const r = (region || '').toUpperCase();
  if (r.includes('NORTH')) return 'FFC6E0B4';
  if (r.includes('EAST')) return 'FFBDD7EE';
  if (r.includes('WEST')) return 'FFF8CBAD';
  if (r.includes('SOUTH')) return 'FFD9D9D9';
  return 'FFF1F5F9';
}

export function applySummaryHeaderStyle(row: ExcelJS.Row): void {
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

export function applyRegionRowStyle(row: ExcelJS.Row, region: string): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(region) } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  row.getCell(3).font = { color: { argb: 'FF059669' } };
  row.getCell(4).font = { color: { argb: 'FFDC2626' } };
  row.getCell(5).font = { bold: true };
}

function getAggregate(
  item: BranchSummaryRow,
  key: keyof BranchSummaryRow,
  regionBranches: BranchSummaryRow[]
): number {
  const getAllChildren = (id: number): BranchSummaryRow[] => {
    const direct = regionBranches.filter((b) => b.parentId === id);
    let all = [...direct];
    direct.forEach((d) => {
      all = [...all, ...getAllChildren(d.officeId)];
    });
    return all;
  };
  const allDescendants = getAllChildren(item.officeId);
  return (
    Number(item[key] || 0) +
    allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0)
  );
}

export async function buildSummaryDashboardWorkbook(
  summaryData: BranchSummaryRow[],
  sheetName = 'Summary Dashboard'
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  const regions = Array.from(new Set(summaryData.map((b) => b.region))).sort();
  const topLevelBranches = summaryData.filter(
    (b) => b.parentId === 0 || !summaryData.find((p) => p.officeId === b.parentId)
  );

  sheet.addRow(['Regional Performance']).font = { bold: true, size: 12 };
  const regHeader = sheet.addRow([
    'Region',
    'Total',
    'Solved',
    'Cancelled',
    'Open',
    '<2 Days',
    '2-7 Days',
    '7-15 Days',
    '>15 Days',
    'Parts',
    'Engineers',
  ]);
  applySummaryHeaderStyle(regHeader);

  regions.forEach((region) => {
    const rb = summaryData.filter((b) => b.region === region);
    const t = rb.reduce(
      (acc, b) => ({
        t: acc.t + Number(b.total_calls || 0),
        s: acc.s + Number(b.solved_calls || 0),
        c: acc.c + Number(b.cancelled_calls || 0),
        o: acc.o + Number(b.open_calls || 0),
        a2: acc.a2 + Number(b.age_2 || 0),
        a3: acc.a3 + Number(b.age_3 || 0),
        a7: acc.a7 + Number(b.age_7 || 0),
        a15: acc.a15 + Number(b.age_15 || 0),
        p: acc.p + Number(b.part_pending || 0),
        e: acc.e + Number(b.active_eng || 0),
      }),
      { t: 0, s: 0, c: 0, o: 0, a2: 0, a3: 0, a7: 0, a15: 0, p: 0, e: 0 }
    );

    const r = sheet.addRow([region, t.t, t.s, t.c, t.o, t.a2, t.a3, t.a7, t.a15, t.p, t.e]);
    applyRegionRowStyle(r, region);
  });

  const aiRow = sheet.addRow([
    'AI TOTAL',
    summaryData.reduce((s, b) => s + Number(b.total_calls || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.solved_calls || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.cancelled_calls || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.open_calls || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.age_2 || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.age_3 || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.age_7 || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.age_15 || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.part_pending || 0), 0),
    summaryData.reduce((s, b) => s + Number(b.active_eng || 0), 0),
  ]);
  aiRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    cell.font = { bold: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  sheet.addRow([]);

  sheet.addRow(['Branch Wise Performance']).font = { bold: true, size: 12 };
  const brHeader = sheet.addRow([
    'Branch',
    'Total',
    'Solved',
    'Cancelled',
    'Open',
    '<2 Days',
    '2-7 Days',
    '7-15 Days',
    '>15 Days',
    'Parts',
    'Engineers',
  ]);
  applySummaryHeaderStyle(brHeader);

  topLevelBranches
    .sort((a, b) => a.region.localeCompare(b.region))
    .forEach((b) => {
      const rb = summaryData.filter((x) => x.region === b.region);
      const r = sheet.addRow([
        b.branch,
        getAggregate(b, 'total_calls', rb),
        getAggregate(b, 'solved_calls', rb),
        getAggregate(b, 'cancelled_calls', rb),
        getAggregate(b, 'open_calls', rb),
        getAggregate(b, 'age_2', rb),
        getAggregate(b, 'age_3', rb),
        getAggregate(b, 'age_7', rb),
        getAggregate(b, 'age_15', rb),
        getAggregate(b, 'part_pending', rb),
        getAggregate(b, 'active_eng', rb),
      ]);
      applyRegionRowStyle(r, b.region);
    });

  return workbook;
}

export async function buildKeyAccountMisWorkbook(
  accountsData: AccountSummaryRow[],
  sheetName = 'Key Account MIS',
  opts?: { hideRegion?: boolean }
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  const hideRegion = opts?.hideRegion ?? false;

  const sorted = [...accountsData].sort((a, b) =>
    hideRegion
      ? a.account.localeCompare(b.account)
      : a.region.localeCompare(b.region) || a.account.localeCompare(b.account)
  );

  const kaHeader = sheet.addRow(
    hideRegion
      ? [
          'Account',
          'Population',
          'Total',
          'Solved',
          'Cancelled',
          'Open',
          '<2 Days',
          '2-7 Days',
          '7-15 Days',
          '>15 Days',
          'Parts',
          'Engineers',
        ]
      : [
          'Region',
          'Account',
          'Population',
          'Total',
          'Solved',
          'Cancelled',
          'Open',
          '<2 Days',
          '2-7 Days',
          '7-15 Days',
          '>15 Days',
          'Parts',
          'Engineers',
        ]
  );
  applySummaryHeaderStyle(kaHeader);

  sorted.forEach((a) => {
    const openCalls = Number(a.open_calls || 0);
    const rowValues = hideRegion
      ? [
          a.account,
          a.population || 0,
          a.total_calls,
          a.total_solved,
          a.cancelled_calls,
          openCalls,
          a.age_2,
          a.age_3,
          a.age_7,
          a.age_15,
          a.part_pending,
          a.active_eng,
        ]
      : [
          a.region,
          a.account,
          a.population || 0,
          a.total_calls,
          a.total_solved,
          a.cancelled_calls,
          openCalls,
          a.age_2,
          a.age_3,
          a.age_7,
          a.age_15,
          a.part_pending,
          a.active_eng,
        ];
    const r = sheet.addRow(rowValues);
    applyRegionRowStyle(r, a.region);
    const solvedCol = hideRegion ? 4 : 5;
    const cancelledCol = hideRegion ? 5 : 6;
    const openCol = hideRegion ? 6 : 7;
    r.getCell(solvedCol).font = { color: { argb: 'FF059669' } };
    r.getCell(cancelledCol).font = { color: { argb: 'FFDC2626' } };
    r.getCell(openCol).font = { bold: true };
  });

  return workbook;
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function misExportDateLabel(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function summaryDashboardFilename(date = new Date()): string {
  return `WRL Summary Dashboard — ${misExportDateLabel(date)}.xlsx`;
}

export function keyAccountMisFilename(date = new Date()): string {
  return `WRL Key Account MIS — ${misExportDateLabel(date)}.xlsx`;
}

/** Browser download helper for MIS report tabs. */
export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const t0 = performance.now();
  console.info('[download-workbook] begin', { filename, sheets: workbook.worksheets.length });
  const buffer = await workbook.xlsx.writeBuffer();
  console.info('[download-workbook] buffer-ready', {
    elapsed_ms: Math.round(performance.now() - t0),
    bytes: (buffer as ArrayBuffer).byteLength ?? 0,
  });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  const downloadUrl = URL.createObjectURL(blob);
  link.href = downloadUrl;
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  // For large files, ensure the element is attached and click occurs
  // before revoking the object URL to avoid flaky no-download behavior.
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  console.info('[download-workbook] click-dispatched', {
    elapsed_ms: Math.round(performance.now() - t0),
  });
  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
    link.remove();
    console.info('[download-workbook] cleanup-done', { filename });
  }, 60_000);
}
