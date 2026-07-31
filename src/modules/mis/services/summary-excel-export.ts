import type ExcelJS from 'exceljs';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/summary/derive';

const BRANCH_SUM_KEYS = [
  'total_calls',
  'solved_calls',
  'cancelled_calls',
  'open_calls',
  'age_2',
  'age_3',
  'age_7',
  'age_15',
  'part_pending',
  'all_total',
  'all_solved',
  'all_cancelled',
  'all_open',
  'all_age_2',
  'all_age_3',
  'all_age_7',
  'all_age_15',
  'all_part_pending',
  'all_tech_solved',
  'tech_solved_calls',
  'deployment_total',
  'deployment_done',
  'installation_total',
  'installation_done',
  'active_eng',
  'population',
] as const satisfies ReadonlyArray<keyof BranchSummaryRow>;

function branchDisplayKey(region: unknown, branch: unknown): string {
  return `${String(region ?? '').trim().toUpperCase()}::${String(branch ?? '').trim().toLowerCase()}`;
}

function mergeTopLevelBranchRowsByName(rows: BranchSummaryRow[]): BranchSummaryRow[] {
  const map = new Map<string, BranchSummaryRow>();
  for (const row of rows) {
    const key = branchDisplayKey(row.region, row.branch);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    const preferRow = Number(row.total_calls) > Number(prev.total_calls) ? row : prev;
    const merged: BranchSummaryRow = {
      ...preferRow,
      branch: preferRow.branch || prev.branch || row.branch,
      region: preferRow.region || prev.region || row.region,
      headcount: Math.max(Number(prev.headcount) || 0, Number(row.headcount) || 0),
    };
    for (const k of BRANCH_SUM_KEYS) {
      (merged as Record<(typeof BRANCH_SUM_KEYS)[number], number>)[k] =
        (Number(prev[k]) || 0) + (Number(row[k]) || 0);
    }
    map.set(key, merged);
  }
  return [...map.values()].sort((a, b) => Number(b.total_calls) - Number(a.total_calls));
}

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

export function applyRegionRowStyle(
  row: ExcelJS.Row,
  region: string,
  opts?: { solvedCol?: number; cancelledCol?: number | null; openCol?: number }
): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(region) } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  const solvedCol = opts?.solvedCol ?? 3;
  const cancelledCol = opts?.cancelledCol === undefined ? 4 : opts.cancelledCol;
  const openCol = opts?.openCol ?? 5;
  row.getCell(solvedCol).font = { color: { argb: 'FF059669' } };
  if (cancelledCol != null) {
    row.getCell(cancelledCol).font = { color: { argb: 'FFDC2626' } };
  }
  row.getCell(openCol).font = { bold: true };
}

export function applyAge15CellStyle(cell: ExcelJS.Cell, age15: number): void {
  if (age15 < 30) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    cell.font = { color: { argb: 'FF166534' }, bold: true };
    return;
  }
  if (age15 <= 80) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    cell.font = { color: { argb: 'FF92400E' }, bold: true };
    return;
  }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
  cell.font = { color: { argb: 'FF991B1B' }, bold: true };
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

export type SummaryExcelExcludeCancelledOpts = {
  excludeCancelled?: boolean;
};

export async function buildSummaryDashboardWorkbook(
  summaryData: BranchSummaryRow[],
  sheetName = 'Summary Dashboard',
  opts?: SummaryExcelExcludeCancelledOpts
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  const excludeCancelled = opts?.excludeCancelled === true;
  const metricStyle = excludeCancelled
    ? { solvedCol: 3, cancelledCol: null as number | null, openCol: 4 }
    : undefined;

  const regions = Array.from(new Set(summaryData.map((b) => b.region))).sort();
  const topLevelBranches = Array.from(new Set(summaryData.map((b) => b.region)))
    .sort()
    .flatMap((region) => {
      const regionBranches = summaryData.filter((b) => b.region === region);
      const rawTopLevel = regionBranches.filter(
        (b) => b.parentId === 0 || !regionBranches.some((p) => p.officeId === b.parentId)
      );
      return mergeTopLevelBranchRowsByName(rawTopLevel).map((branch) => ({
        ...branch,
        region,
      }));
    });

  sheet.addRow(['Regional Performance']).font = { bold: true, size: 12 };
  const regHeader = sheet.addRow(
    excludeCancelled
      ? [
          'Region',
          'Total',
          'Solved',
          'Open',
          '<2 Days',
          '3-7 Days',
          '8-15 Days',
          '>15 Days',
          'Parts',
          'Engineers',
        ]
      : [
          'Region',
          'Total',
          'Solved',
          'Cancelled',
          'Open',
          '<2 Days',
          '3-7 Days',
          '8-15 Days',
          '>15 Days',
          'Parts',
          'Engineers',
        ]
  );
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

    const total = excludeCancelled ? t.s + t.o : t.t;
    const r = sheet.addRow(
      excludeCancelled
        ? [region, total, t.s, t.o, t.a2, t.a3, t.a7, t.a15, t.p, t.e]
        : [region, total, t.s, t.c, t.o, t.a2, t.a3, t.a7, t.a15, t.p, t.e]
    );
    applyRegionRowStyle(r, region, metricStyle);
    const age15Col = excludeCancelled ? 8 : 9;
    applyAge15CellStyle(r.getCell(age15Col), Number(t.a15 || 0));
  });

  const allSolved = summaryData.reduce((s, b) => s + Number(b.solved_calls || 0), 0);
  const allOpen = summaryData.reduce((s, b) => s + Number(b.open_calls || 0), 0);
  const allCancelled = summaryData.reduce((s, b) => s + Number(b.cancelled_calls || 0), 0);
  const allTotal = excludeCancelled
    ? allSolved + allOpen
    : summaryData.reduce((s, b) => s + Number(b.total_calls || 0), 0);

  const aiRow = sheet.addRow(
    excludeCancelled
      ? [
          'AI TOTAL',
          allTotal,
          allSolved,
          allOpen,
          summaryData.reduce((s, b) => s + Number(b.age_2 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.age_3 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.age_7 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.age_15 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.part_pending || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.active_eng || 0), 0),
        ]
      : [
          'AI TOTAL',
          allTotal,
          allSolved,
          allCancelled,
          allOpen,
          summaryData.reduce((s, b) => s + Number(b.age_2 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.age_3 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.age_7 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.age_15 || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.part_pending || 0), 0),
          summaryData.reduce((s, b) => s + Number(b.active_eng || 0), 0),
        ]
  );
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
  const aiAge15Col = excludeCancelled ? 8 : 9;
  applyAge15CellStyle(aiRow.getCell(aiAge15Col), Number(aiRow.getCell(aiAge15Col).value || 0));

  sheet.addRow([]);

  sheet.addRow(['Branch Wise Performance']).font = { bold: true, size: 12 };
  const brHeader = sheet.addRow(
    excludeCancelled
      ? [
          'Branch',
          'Total',
          'Solved',
          'Open',
          '<2 Days',
          '3-7 Days',
          '8-15 Days',
          '>15 Days',
          'Parts',
          'Engineers',
        ]
      : [
          'Branch',
          'Total',
          'Solved',
          'Cancelled',
          'Open',
          '<2 Days',
          '3-7 Days',
          '8-15 Days',
          '>15 Days',
          'Parts',
          'Engineers',
        ]
  );
  applySummaryHeaderStyle(brHeader);

  topLevelBranches.forEach((b) => {
      const rb = summaryData.filter((x) => x.region === b.region);
      const solved = getAggregate(b, 'solved_calls', rb);
      const open = getAggregate(b, 'open_calls', rb);
      const total = excludeCancelled ? solved + open : getAggregate(b, 'total_calls', rb);
      const r = sheet.addRow(
        excludeCancelled
          ? [
              b.branch,
              total,
              solved,
              open,
              getAggregate(b, 'age_2', rb),
              getAggregate(b, 'age_3', rb),
              getAggregate(b, 'age_7', rb),
              getAggregate(b, 'age_15', rb),
              getAggregate(b, 'part_pending', rb),
              getAggregate(b, 'active_eng', rb),
            ]
          : [
              b.branch,
              total,
              solved,
              getAggregate(b, 'cancelled_calls', rb),
              open,
              getAggregate(b, 'age_2', rb),
              getAggregate(b, 'age_3', rb),
              getAggregate(b, 'age_7', rb),
              getAggregate(b, 'age_15', rb),
              getAggregate(b, 'part_pending', rb),
              getAggregate(b, 'active_eng', rb),
            ]
      );
      applyRegionRowStyle(r, b.region, metricStyle);
      const age15Col = excludeCancelled ? 8 : 9;
      applyAge15CellStyle(r.getCell(age15Col), Number(getAggregate(b, 'age_15', rb) || 0));
    });

  return workbook;
}

export async function buildKeyAccountMisWorkbook(
  accountsData: AccountSummaryRow[],
  sheetName = 'Key Account MIS',
  opts?: { hideRegion?: boolean; excludeCancelled?: boolean }
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  const hideRegion = opts?.hideRegion ?? false;
  const excludeCancelled = opts?.excludeCancelled === true;

  const sorted = [...accountsData].sort((a, b) =>
    hideRegion
      ? a.account.localeCompare(b.account)
      : a.region.localeCompare(b.region) || a.account.localeCompare(b.account)
  );

  const kaHeader = sheet.addRow(
    hideRegion
      ? excludeCancelled
        ? [
            'Account',
            'Population',
            'Total',
            'Solved',
            'Open',
            '<2 Days',
            '3-7 Days',
            '8-15 Days',
            '>15 Days',
            'Parts',
            'Engineers',
          ]
        : [
            'Account',
            'Population',
            'Total',
            'Solved',
            'Cancelled',
            'Open',
            '<2 Days',
            '3-7 Days',
            '8-15 Days',
            '>15 Days',
            'Parts',
            'Engineers',
          ]
      : excludeCancelled
        ? [
            'Region',
            'Account',
            'Population',
            'Total',
            'Solved',
            'Open',
            '<2 Days',
            '3-7 Days',
            '8-15 Days',
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
            '3-7 Days',
            '8-15 Days',
            '>15 Days',
            'Parts',
            'Engineers',
          ]
  );
  applySummaryHeaderStyle(kaHeader);

  sorted.forEach((a) => {
    const openCalls = Number(a.open_calls || 0);
    const solved = Number(a.total_solved || 0);
    const total = excludeCancelled ? solved + openCalls : Number(a.total_calls || 0);
    const rowValues = hideRegion
      ? excludeCancelled
        ? [
            a.account,
            a.population || 0,
            total,
            solved,
            openCalls,
            a.age_2,
            a.age_3,
            a.age_7,
            a.age_15,
            a.part_pending,
            a.active_eng,
          ]
        : [
            a.account,
            a.population || 0,
            total,
            solved,
            a.cancelled_calls,
            openCalls,
            a.age_2,
            a.age_3,
            a.age_7,
            a.age_15,
            a.part_pending,
            a.active_eng,
          ]
      : excludeCancelled
        ? [
            a.region,
            a.account,
            a.population || 0,
            total,
            solved,
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
            total,
            solved,
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
    const solvedCol = hideRegion ? 4 : 5;
    const cancelledCol = excludeCancelled ? null : hideRegion ? 5 : 6;
    const openCol = excludeCancelled ? (hideRegion ? 5 : 6) : hideRegion ? 6 : 7;
    applyRegionRowStyle(r, a.region, { solvedCol, cancelledCol, openCol });
    const age15Col = excludeCancelled ? (hideRegion ? 9 : 10) : hideRegion ? 10 : 11;
    applyAge15CellStyle(r.getCell(age15Col), Number(a.age_15 || 0));
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

const recentDownloadNames = new Map<string, number>();

export type PreparedFileExport = {
  blob: Blob;
  filename: string;
  objectUrl: string;
  /** Non-fatal issue — file is still downloadable. */
  warning?: string;
};

/** Avoid browser duplicate-download suppression when exporting the same name twice. */
export function resolveUniqueDownloadFilename(filename: string): string {
  const base = filename.includes('.') ? filename : `${filename}.xlsx`;
  const count = recentDownloadNames.get(base) ?? 0;
  recentDownloadNames.set(base, count + 1);
  if (count === 0) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : '';
  return `${stem} (${count + 1})${ext}`;
}

function downloadCleanupDelayMs(blob: Blob): number {
  const mb = blob.size / (1024 * 1024);
  if (mb < 1) return 250;
  if (mb < 5) return 3000;
  if (mb < 20) return 10000;
  return 30000;
}

function scheduleDownloadCleanup(
  link: HTMLAnchorElement,
  downloadUrl: string,
  filename: string,
  blob: Blob
): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = () => {
      URL.revokeObjectURL(downloadUrl);
      link.remove();
      console.info('[download-workbook] cleanup-done', { filename });
      resolve();
    };
    const delayMs = downloadCleanupDelayMs(blob);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        window.setTimeout(cleanup, delayMs);
      });
    } else {
      window.setTimeout(cleanup, delayMs);
    }
  });
}

export type TriggerBlobDownloadOptions = {
  /** Reuse a URL from workbookToPreparedExport instead of creating a second one. */
  objectUrl?: string;
  /** When false, the caller revokes objectUrl (e.g. export queue manual save link). */
  autoRevoke?: boolean;
};

/** Trigger a file save in the browser (anchor fallback; no confirmation of success). */
export async function triggerBlobDownload(
  blob: Blob,
  filename: string,
  options: TriggerBlobDownloadOptions = {}
): Promise<string> {
  let link: HTMLAnchorElement | null = null;
  const downloadUrl = options.objectUrl ?? URL.createObjectURL(blob);
  const autoRevoke = options.autoRevoke !== false;
  try {
    link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.style.position = 'fixed';
    link.style.left = '-9999px';
    link.style.opacity = '0';
    document.body.appendChild(link);
    if (typeof MouseEvent !== 'undefined') {
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
      );
    } else {
      link.click();
    }
    // Don't await revoke delay — large CSVs waited 30s here while the file was already Done.
    if (autoRevoke) {
      void scheduleDownloadCleanup(link, downloadUrl, filename, blob);
    } else {
      link.remove();
    }
    return downloadUrl;
  } catch (err) {
    if (autoRevoke && !options.objectUrl) URL.revokeObjectURL(downloadUrl);
    link?.remove();
    throw err;
  }
}

export function revokePreparedExport(prepared: PreparedFileExport): void {
  URL.revokeObjectURL(prepared.objectUrl);
}

export function blobToPreparedExport(blob: Blob, filename: string): PreparedFileExport {
  const resolvedName = resolveUniqueDownloadFilename(filename);
  return {
    blob,
    filename: resolvedName,
    objectUrl: URL.createObjectURL(blob),
  };
}

export async function workbookToPreparedExport(
  workbook: ExcelJS.Workbook,
  filename: string
): Promise<PreparedFileExport> {
  const t0 = performance.now();
  const buffer = await workbook.xlsx.writeBuffer();
  const resolvedName = resolveUniqueDownloadFilename(filename);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const objectUrl = URL.createObjectURL(blob);
  console.info('[download-workbook] buffer-ready', {
    filename: resolvedName,
    elapsed_ms: Math.round(performance.now() - t0),
    bytes: blob.size,
  });
  return {
    blob,
    filename: resolvedName,
    objectUrl,
  };
}

/** Browser download helper for MIS report tabs. */
export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const t0 = performance.now();
  console.info('[download-workbook] begin', { filename, sheets: workbook.worksheets.length });
  const prepared = await workbookToPreparedExport(workbook, filename);
  console.info('[download-workbook] click-dispatched', {
    filename: prepared.filename,
    elapsed_ms: Math.round(performance.now() - t0),
  });
  await triggerBlobDownload(prepared.blob, prepared.filename, {
    objectUrl: prepared.objectUrl,
    autoRevoke: true,
  });
}
