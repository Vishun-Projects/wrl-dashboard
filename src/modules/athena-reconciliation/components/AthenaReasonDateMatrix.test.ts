import { describe, expect, it } from 'vitest';
import { buildReasonDateWindow } from '@/modules/athena-reconciliation/components/AthenaReasonDateMatrix';

describe('buildReasonDateWindow', () => {
  it('returns 15 inclusive days ending on anchor', () => {
    const w = buildReasonDateWindow('2026-08-30', '2026-01-01', '2026-08-30');
    expect(w.end).toBe('2026-08-30');
    expect(w.start).toBe('2026-08-16');
  });

  it('clamps start to bound when window is shorter than 15 days', () => {
    const w = buildReasonDateWindow('2026-01-10', '2026-01-01', '2026-08-30');
    expect(w.start).toBe('2026-01-01');
    expect(w.end).toBe('2026-01-10');
  });
});
