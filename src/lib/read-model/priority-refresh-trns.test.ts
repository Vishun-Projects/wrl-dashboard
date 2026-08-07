import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchCrmRowsByTrns = vi.fn();
const withClient = vi.fn();
const tryAcquireSyncLock = vi.fn();
const releaseSyncLock = vi.fn();
const getSyncState = vi.fn();
const applyCrmRowsToHot = vi.fn();

vi.mock('@/lib/read-model/crm-fetch', () => ({
  fetchCrmRowsByTrns: (...args: unknown[]) => (globalThis as any).__mockFetchCrmRowsByTrns?.(...args),
}));
vi.mock('@/lib/read-model/db', () => ({
  withClient: (fn: (client: unknown) => unknown) => (globalThis as any).__mockWithClient?.(fn),
}));
vi.mock('@/lib/read-model/lock', () => ({
  tryAcquireSyncLock: (...args: unknown[]) => (globalThis as any).__mockTryAcquireSyncLock?.(...args),
  releaseSyncLock: (...args: unknown[]) => (globalThis as any).__mockReleaseSyncLock?.(...args),
  getSyncState: (...args: unknown[]) => (globalThis as any).__mockGetSyncState?.(...args),
}));
vi.mock('@/lib/read-model/apply-crm-delta', () => ({
  applyCrmRowsToHot: (...args: unknown[]) => (globalThis as any).__mockApplyCrmRowsToHot?.(...args),
}));

describe('priorityRefreshHotFromCrm', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    (globalThis as any).__mockFetchCrmRowsByTrns = fetchCrmRowsByTrns;
    (globalThis as any).__mockWithClient = withClient;
    (globalThis as any).__mockTryAcquireSyncLock = tryAcquireSyncLock;
    (globalThis as any).__mockReleaseSyncLock = releaseSyncLock;
    (globalThis as any).__mockGetSyncState = getSyncState;
    (globalThis as any).__mockApplyCrmRowsToHot = applyCrmRowsToHot;

    withClient.mockImplementation(async (fn: (client: unknown) => unknown) => fn({}));
  });

  it('normalizePriorityTrns dedupes and trims', async () => {
    const { normalizePriorityTrns } = await import('./priority-refresh-trns');
    expect(normalizePriorityTrns([' 26A ', '26B', '26A', '', '  '])).toEqual(['26A', '26B']);
  });

  it('returns empty without CRM fetch when TRN list is blank', async () => {
    const { priorityRefreshHotFromCrm } = await import('./priority-refresh-trns');
    await expect(priorityRefreshHotFromCrm(['', '  '])).resolves.toEqual({ kind: 'empty' });
    expect(fetchCrmRowsByTrns).not.toHaveBeenCalled();
  });

  it('returns coalesced when sync lock is held', async () => {
    fetchCrmRowsByTrns.mockResolvedValue([{ vtrnno: '26A' }]);
    tryAcquireSyncLock.mockResolvedValue(false);
    const { priorityRefreshHotFromCrm } = await import('./priority-refresh-trns');
    await expect(priorityRefreshHotFromCrm(['26A'])).resolves.toEqual({ kind: 'coalesced' });
    expect(applyCrmRowsToHot).not.toHaveBeenCalled();
    expect(releaseSyncLock).not.toHaveBeenCalled();
  });

  it('applies CRM rows without advancing watermarks', async () => {
    fetchCrmRowsByTrns.mockResolvedValue([{ vtrnno: '26A' }, { vtrnno: '26B' }]);
    tryAcquireSyncLock.mockResolvedValue(true);
    getSyncState.mockResolvedValue({ entity: 'calls_latest_hot' });
    applyCrmRowsToHot.mockResolvedValue({ rowsUpserted: 2, rowsDeleted: 0 });
    const { priorityRefreshHotFromCrm } = await import('./priority-refresh-trns');
    await expect(priorityRefreshHotFromCrm(['26A', '26B', '26A'])).resolves.toEqual({
      kind: 'ok',
      rowsUpserted: 2,
      rowsFetched: 2,
    });
    expect(fetchCrmRowsByTrns).toHaveBeenCalledWith(['26A', '26B'], {
      includeTransferred: true,
    });
    expect(applyCrmRowsToHot).toHaveBeenCalledWith(
      {},
      [{ vtrnno: '26A' }, { vtrnno: '26B' }],
      { state: { entity: 'calls_latest_hot' }, advanceWatermarks: false }
    );
    expect(releaseSyncLock).toHaveBeenCalledWith({}, 'ok', 2);
  });
});
