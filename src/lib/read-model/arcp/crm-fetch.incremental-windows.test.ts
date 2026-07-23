import { describe, expect, it } from 'vitest';
import { arcpIncrementalWindows } from '@/lib/read-model/arcp/crm-fetch';

describe('arcpIncrementalWindows', () => {
  it('splits a multi-day catch-up into local day windows', () => {
    const from = new Date(2026, 6, 15, 3, 33, 39); // Jul 15 03:33 local
    const end = new Date(2026, 6, 17, 14, 0, 0); // Jul 17 14:00 local
    const windows = arcpIncrementalWindows(from, end);
    expect(windows.length).toBe(3);
    expect(windows[0].from.getTime()).toBe(from.getTime());
    expect(windows[0].toExclusive).toEqual(new Date(2026, 6, 16));
    expect(windows[1].from).toEqual(new Date(2026, 6, 16));
    expect(windows[1].toExclusive).toEqual(new Date(2026, 6, 17));
    expect(windows[2].from).toEqual(new Date(2026, 6, 17));
    expect(windows[2].toExclusive.getTime()).toBe(end.getTime());
  });

  it('returns empty when end is not after watermark', () => {
    const t = new Date(2026, 6, 15, 12, 0, 0);
    expect(arcpIncrementalWindows(t, t)).toEqual([]);
    expect(arcpIncrementalWindows(t, new Date(t.getTime() - 1))).toEqual([]);
  });
});
