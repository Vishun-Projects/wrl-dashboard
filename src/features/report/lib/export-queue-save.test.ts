import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { triggerBlobDownload } from '@/features/report/lib/summary-excel-export';

/**
 * Lightweight stand-in for queue pump download step (no React hook runtime needed).
 */
async function simulateQueueDownload(
  prepared: { blob: Blob; filename: string; objectUrl?: string },
  patch: (status: string, error?: string) => void
): Promise<{ downloaded: boolean; filename: string }> {
  patch('downloading');
  await triggerBlobDownload(prepared.blob, prepared.filename, {
    objectUrl: prepared.objectUrl,
    autoRevoke: false,
  });
  patch('done');
  return { downloaded: true, filename: prepared.filename };
}

describe('export queue direct download contract', () => {
  const prepared = {
    blob: new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: 'report.xlsx',
    objectUrl: 'blob:mock-url',
  };

  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clickSpy = vi.fn();
    const mockLink = {
      href: '',
      download: '',
      style: { position: '', left: '', opacity: '' },
      click: clickSpy,
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockLink),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout.bind(globalThis) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks done after triggerBlobDownload dispatches click', async () => {
    let status = 'running';

    const resultPromise = simulateQueueDownload(prepared, (next) => {
      status = next;
    });
    await vi.advanceTimersByTimeAsync(250);
    const result = await resultPromise;

    expect(result.downloaded).toBe(true);
    expect(result.filename).toBe('report.xlsx');
    expect(status).toBe('done');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
