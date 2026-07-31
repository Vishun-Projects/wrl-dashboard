import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAge15CellStyle,
  buildKeyAccountMisWorkbook,
  buildSummaryDashboardWorkbook,
  resolveUniqueDownloadFilename,
  triggerBlobDownload,
  workbookToPreparedExport,
} from '@/modules/mis/services/summary-excel-export';
import {
  buildAccountDisplayRows,
  sumMergedAccountMetric,
} from '@/modules/mis/components/SummaryMergedMetricCell';
import { buildSummaryDashboardExportAlign } from '@/modules/mis/services/summary-trace-export';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/summary/derive';

function createMockWorkbook() {
  return {
    worksheets: [{ name: 'Sheet1' }],
    xlsx: {
      writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    },
  };
}

const sampleBranch: BranchSummaryRow = {
  officeId: 1,
  parentId: 0,
  branch: 'Delhi',
  region: 'NORTH ZONE',
  total_calls: 100,
  solved_calls: 90,
  cancelled_calls: 2,
  open_calls: 8,
  age_2: 5,
  age_3: 2,
  age_7: 1,
  age_15: 0,
  part_pending: 1,
  all_total: 100,
  all_solved: 90,
  all_cancelled: 2,
  all_open: 8,
  all_age_2: 5,
  all_age_3: 2,
  all_age_7: 1,
  all_age_15: 0,
  all_part_pending: 1,
  all_tech_solved: 0,
  tech_solved_calls: 0,
  deployment_total: 0,
  deployment_done: 0,
  installation_total: 0,
  installation_done: 0,
  active_eng: 12,
  population: 100,
  headcount: 5,
};

const sampleAccount: AccountSummaryRow = {
  region: 'NORTH ZONE',
  account: 'Nestle',
  population: 10,
  total_calls: 50,
  total_solved: 45,
  cancelled_calls: 1,
  open_calls: 4,
  age_2: 2,
  age_3: 1,
  age_7: 1,
  age_15: 0,
  part_pending: 0,
  deployment_total: 0,
  deployment_done: 0,
  installation_total: 0,
  installation_done: 0,
  active_eng: 3,
  headcount: 2,
  total_tech_solved: 0,
};

describe('resolveUniqueDownloadFilename', () => {
  it('returns the base name on first use and suffixes duplicates', () => {
    const first = resolveUniqueDownloadFilename('WRL_MIS_Report_2026-07-03.xlsx');
    const second = resolveUniqueDownloadFilename('WRL_MIS_Report_2026-07-03.xlsx');
    const third = resolveUniqueDownloadFilename('WRL_MIS_Report_2026-07-03.xlsx');

    expect(first).toBe('WRL_MIS_Report_2026-07-03.xlsx');
    expect(second).toBe('WRL_MIS_Report_2026-07-03 (2).xlsx');
    expect(third).toBe('WRL_MIS_Report_2026-07-03 (3).xlsx');
  });

  it('appends .xlsx when missing extension', () => {
    expect(resolveUniqueDownloadFilename('report')).toBe('report.xlsx');
  });

  it('preserves csv extension', () => {
    expect(resolveUniqueDownloadFilename('register.csv')).toBe('register.csv');
  });
});

describe('buildSummaryDashboardWorkbook excludeCancelled', () => {
  it('includes Cancelled by default', async () => {
    const wb = await buildSummaryDashboardWorkbook([sampleBranch]);
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(2).values as unknown[];
    expect(header).toContain('Cancelled');
    const data = sheet.getRow(3).values as unknown[];
    expect(data).toContain(100);
    expect(data).toContain(2);
  }, 30000);

  it('omits Cancelled and uses solved+open total when excludeCancelled', async () => {
    const wb = await buildSummaryDashboardWorkbook([sampleBranch], 'Summary Dashboard', {
      excludeCancelled: true,
    });
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(2).values as unknown[];
    expect(header).not.toContain('Cancelled');
    // Region, Total(solved+open), Solved, Open — no cancelled column
    expect(sheet.getRow(3).getCell(2).value).toBe(98);
    expect(sheet.getRow(3).getCell(3).value).toBe(90);
    expect(sheet.getRow(3).getCell(4).value).toBe(8);
  });

  it('applies >15 day color bands', async () => {
    const wb = await buildSummaryDashboardWorkbook([
      { ...sampleBranch, age_15: 10 },
      { ...sampleBranch, officeId: 2, region: 'SOUTH ZONE', age_15: 50 },
      { ...sampleBranch, officeId: 3, region: 'WEST ZONE', age_15: 120 },
    ]);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(3).getCell(9).fill).toBeDefined();
  });
});

function findAiTotalCell(sheet: { eachRow: Function }): number {
  let total = -1;
  sheet.eachRow((row: { getCell: (n: number) => { value: unknown } }) => {
    if (String(row.getCell(1).value ?? '') === 'AI TOTAL') {
      total = Number(row.getCell(2).value ?? 0);
    }
  });
  return total;
}

describe('buildSummaryDashboardWorkbook uiAlign matches dashboard AI', () => {
  it('CRM-only excel AI TOTAL equals CRM branch Σ total_calls', async () => {
    const branches: BranchSummaryRow[] = [
      { ...sampleBranch, total_calls: 100 },
      { ...sampleBranch, officeId: 2, region: 'SOUTH ZONE', branch: 'Chennai', total_calls: 50 },
    ];
    const crmSum = branches.reduce((s, b) => s + Number(b.total_calls), 0);
    const uiAlign = buildSummaryDashboardExportAlign({
      summaryData: branches,
      mergedAccountRows: [],
      mergeFlags: { crm: true, client: false },
      clientMergeWithCrm: { cadbury: false, coke: false },
      clientOnlyMode: false,
    });
    expect(uiAlign.aiRow.total_calls).toBe(crmSum);

    const wb = await buildSummaryDashboardWorkbook(branches, undefined, { uiAlign });
    expect(findAiTotalCell(wb.worksheets[0])).toBe(crmSum);
  });

  it('CRM+Cadbury merge-off excel AI TOTAL equals sumMergedAccountMetric', async () => {
    const branches: BranchSummaryRow[] = [
      { ...sampleBranch, region: 'SOUTH ZONE', total_calls: 200 },
    ];
    const crmAccounts = [
      { region: 'SOUTH ZONE', account: 'Nestle', total_calls: 150, total_solved: 100, cancelled_calls: 10, open_calls: 40, age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0, active_eng: 0 },
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 50, total_solved: 40, cancelled_calls: 0, open_calls: 10, age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0, active_eng: 0 },
    ];
    const clientAccounts = [
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 80, total_solved: 70, cancelled_calls: 0, open_calls: 10, age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0, active_eng: 0 },
    ];
    const mergeFlags = { crm: true, client: true };
    const clientMergeWithCrm = { cadbury: false, coke: false };
    const mergedAccountRows = buildAccountDisplayRows(crmAccounts, clientAccounts, mergeFlags);
    const expected = sumMergedAccountMetric(
      mergedAccountRows,
      clientAccounts,
      'total_calls',
      mergeFlags,
      clientMergeWithCrm
    );
    // Nestle CRM 150 + Cadbury import-only 80 (CRM Cadbury dropped)
    expect(expected).toBe(230);

    const uiAlign = buildSummaryDashboardExportAlign({
      summaryData: branches,
      clientAccountSummaryData: clientAccounts,
      mergedAccountRows,
      mergeFlags,
      clientMergeWithCrm,
      clientOnlyMode: false,
    });
    expect(uiAlign.aiRow.total_calls).toBe(expected);
    // Regional Total uses displayLoggedCallCount (total + cancelled) like the UI.
    expect(uiAlign.regionalRows.find((r) => r.region === 'SOUTH ZONE')?.total_calls).toBe(
      expected + 10
    );

    const wb = await buildSummaryDashboardWorkbook(branches, undefined, { uiAlign });
    expect(findAiTotalCell(wb.worksheets[0])).toBe(expected);
    // Without uiAlign, excel would still be CRM branch-only (200)
    const legacy = await buildSummaryDashboardWorkbook(branches);
    expect(findAiTotalCell(legacy.worksheets[0])).toBe(200);
  });
});

describe('applyAge15CellStyle', () => {
  it('uses green/yellow/red fills by threshold', () => {
    const cell = {
      fill: undefined,
      font: undefined,
    } as unknown as import('exceljs').Cell;
    applyAge15CellStyle(cell, 20);
    expect((cell.fill as import('exceljs').FillPattern).fgColor?.argb).toBe('FFC6EFCE');
    applyAge15CellStyle(cell, 50);
    expect((cell.fill as import('exceljs').FillPattern).fgColor?.argb).toBe('FFFFEB9C');
    applyAge15CellStyle(cell, 90);
    expect((cell.fill as import('exceljs').FillPattern).fgColor?.argb).toBe('FFFFC7CE');
  });
});

describe('buildKeyAccountMisWorkbook excludeCancelled', () => {
  it('includes Cancelled by default', async () => {
    const wb = await buildKeyAccountMisWorkbook([sampleAccount]);
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1).values as unknown[];
    expect(header).toContain('Cancelled');
  });

  it('omits Cancelled and uses solved+open total when excludeCancelled', async () => {
    const wb = await buildKeyAccountMisWorkbook([sampleAccount], 'Key Account MIS', {
      excludeCancelled: true,
    });
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1).values as unknown[];
    expect(header).not.toContain('Cancelled');
    const data = sheet.getRow(2).values as unknown[];
    expect(data).toContain(49);
  });
});

describe('downloadWorkbook', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let revokeSpy: ReturnType<typeof vi.fn>;
  let appendChildSpy: ReturnType<typeof vi.fn>;
  let rafSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clickSpy = vi.fn();
    removeSpy = vi.fn();
    revokeSpy = vi.fn();
    appendChildSpy = vi.fn();
    rafSpy = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    const mockLink = {
      href: '',
      download: '',
      style: { display: '' },
      click: clickSpy,
      remove: removeSpy,
    };

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockLink),
      body: { appendChild: appendChildSpy },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: revokeSpy,
    });
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout.bind(globalThis) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dispatches click and revokes blob URL after cleanup delay', async () => {
    const blob = new Blob(['x'], { type: 'application/octet-stream' });
    await triggerBlobDownload(blob, 'test-export.xlsx');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(rafSpy).toHaveBeenCalled();
  });

  it('keeps blob URL when autoRevoke is false', async () => {
    const blob = new Blob(['x'], { type: 'application/octet-stream' });
    const url = await triggerBlobDownload(blob, 'manual.xlsx', { autoRevoke: false });
    expect(url).toBe('blob:mock-url');
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('allows a second sequential download after cleanup', async () => {
    const workbook = createMockWorkbook();
    const firstPrepared = await workbookToPreparedExport(workbook as never, 'repeat.xlsx');
    await triggerBlobDownload(firstPrepared.blob, firstPrepared.filename);
    await vi.advanceTimersByTimeAsync(250);
    expect(revokeSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockClear();
    revokeSpy.mockClear();
    removeSpy.mockClear();

    const secondPrepared = await workbookToPreparedExport(workbook as never, 'repeat.xlsx');
    await triggerBlobDownload(secondPrepared.blob, secondPrepared.filename);
    await vi.advanceTimersByTimeAsync(250);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
