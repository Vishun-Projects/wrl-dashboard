/** Retry network / 5xx failures for export and file downloads. */

export type FetchWithRetryOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchWithRetryOptions = {}
): Promise<Response> {
  const retries = init.retries ?? 3;
  const retryDelayMs = init.retryDelayMs ?? 1000;
  const { retries: _retries, retryDelayMs: _retryDelayMs, ...requestInit } = init;
  void _retries;
  void _retryDelayMs;

  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(input, requestInit);
      if (!isRetryableStatus(res.status) || attempt === retries - 1) {
        return res;
      }
      await sleep(retryDelayMs * 2 ** attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries - 1) throw err;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Request failed');
}

export type AxiosRetryConfig = {
  retries?: number;
  retryDelayMs?: number;
};

/** Wrap an axios call with retries on network / 5xx / 429. */
export async function withAxiosRetry<T>(
  run: () => Promise<T>,
  config: AxiosRetryConfig = {}
): Promise<T> {
  const retries = config.retries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  let lastErr: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const status =
        err && typeof err === 'object' && 'response' in err
          ? Number((err as { response?: { status?: number } }).response?.status)
          : NaN;
      const noResponse =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: unknown }).response == null
          : true;
      const retryable =
        noResponse || (Number.isFinite(status) && isRetryableStatus(status));
      if (!retryable || attempt === retries - 1) throw err;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Request failed');
}
