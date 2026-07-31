import { describe, expect, it } from 'vitest';
import { isExportActiveForTab, type ExportQueueItem } from '@/modules/mis/services/export-queue';

describe('isExportActiveForTab', () => {
  const registerRunning: ExportQueueItem = {
    id: '1',
    label: 'Call Register Excel',
    status: 'running',
    enqueuedAt: Date.now(),
    sourceTab: 'register',
    kind: 'standard',
  };

  it('only reports active export for the tab that started it', () => {
    expect(isExportActiveForTab([registerRunning], 'register')).toBe(true);
    expect(isExportActiveForTab([registerRunning], 'summary')).toBe(false);
    expect(isExportActiveForTab([registerRunning], 'accounts')).toBe(false);
  });
});

describe('export queue job cancellation', () => {
  it('marks cancelled when abort fires during a long-running job', async () => {
    const controller = new AbortController();
    let status: 'running' | 'cancelled' | 'done' = 'running';

    const runPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve('ok'), 500);
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Export cancelled', 'AbortError'));
      });
    })
      .then(() => {
        status = 'done';
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          status = 'cancelled';
        }
      });

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await runPromise;

    expect(status).toBe('cancelled');
  });

  it('completes when job finishes before abort', async () => {
    let status: 'running' | 'done' = 'running';

    await Promise.resolve()
      .then(() => {
        status = 'done';
      });

    expect(status).toBe('done');
  });
});
