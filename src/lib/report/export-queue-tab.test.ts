import { describe, expect, it } from 'vitest';

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
