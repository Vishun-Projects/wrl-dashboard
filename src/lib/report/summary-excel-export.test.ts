import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadWorkbook,
  resolveUniqueDownloadFilename,
  triggerBlobDownload,
  workbookToPreparedExport,
} from '@/lib/report/summary-excel-export';

function createMockWorkbook() {
  return {
    worksheets: [{ name: 'Sheet1' }],
    xlsx: {
      writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    },
  };
}

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
