import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAge15CellStyle,
  buildKeyAccountMisWorkbook,
  buildSummaryDashboardWorkbook,
  resolveUniqueDownloadFilename,
  triggerBlobDownload,
  workbookToPreparedExport,
} from '@/features/report/lib/summary-excel-export';
import type { AccountSummaryRow, BranchSummaryRow } from '@/features/report/lib/summary-derive';

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

describe('applyAge15CellStyle', () => {
  it('uses green/yellow/red fills by threshold', () => {
    const cell = {
      fill: undefined,
      font: undefined,
    } as unknown as import('exceljs').Cell;
    applyAge15CellStyle(cell, 20);
    expect((cell.fill as any).fgColor.argb).toBe('FFC6EFCE');
    applyAge15CellStyle(cell, 50);
    expect((cell.fill as any).fgColor.argb).toBe('FFFFEB9C');
    applyAge15CellStyle(cell, 90);
    expect((cell.fill as any).fgColor.argb).toBe('FFFFC7CE');
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
    const downloadPromise = triggerBlobDownload(blob, 'test-export.xlsx');
    await vi.advanceTimersByTimeAsync(250);
    await downloadPromise;
    expect(clickSpy).toHaveBeenCalledTimes(1);
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
    const first = triggerBlobDownload(firstPrepared.blob, firstPrepared.filename);
    await vi.advanceTimersByTimeAsync(250);
    await first;

    clickSpy.mockClear();
    revokeSpy.mockClear();
    removeSpy.mockClear();

    const secondPrepared = await workbookToPreparedExport(workbook as never, 'repeat.xlsx');
    const second = triggerBlobDownload(secondPrepared.blob, secondPrepared.filename);
    await vi.advanceTimersByTimeAsync(250);
    await second;
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
