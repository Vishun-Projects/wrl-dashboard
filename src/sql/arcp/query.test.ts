import { describe, expect, it } from 'vitest';
import {
  planArcpLoadJobChunks,
  planArcpSummaryDateChunks,
  resolveArcpClientDetailLoadPlan,
  resolveArcpClientLoadPlan,
  type ArcpLoadEstimateHints,
} from '@/sql/arcp/query';

const postgresHints: ArcpLoadEstimateHints = {
  usePostgres: true,
  coverage: {
    rowCount: 100,
    status: 'ready',
    backfillStart: '2025-01-01',
    callAt: { min: '2025-01-01', max: '2026-12-31' },
    solveAt: { min: '2025-01-01', max: '2026-12-31' },
    bmApprovedAt: { min: '2025-01-01', max: '2026-12-31' },
    hoApprovedAt: { min: '2025-01-01', max: '2026-12-31' },
  },
};

const longDetailOpts = {
  startDate: '2026-01-01',
  endDate: '2026-06-25',
  dateFilterColumn: 'bm_approved_at' as const,
  callType: 'All',
};

describe('ARCP client load planning', () => {
  it('keeps summary loads as a single request when Postgres covers the range', () => {
    const plan = resolveArcpClientLoadPlan(
      {
        startDate: '2026-01-01',
        endDate: '2026-07-28',
        dateFilterColumn: 'bm_approved_at',
        callType: 'All',
      },
      postgresHints
    );

    expect(plan.chunkCount).toBe(1);
    expect(plan.chunkGranularity).toBe('single');
  });

  it('keeps detail exports chunked so progress can advance on long ranges', () => {
    const plan = resolveArcpClientDetailLoadPlan(
      {
        startDate: '2026-01-01',
        endDate: '2026-07-28',
        dateFilterColumn: 'bm_approved_at',
        callType: 'All',
      },
      postgresHints
    );

    expect(plan.chunkCount).toBeGreaterThan(1);
    expect(plan.chunkGranularity).toBe('week');
  });

  it('detail job windows match the client detail plan (not summary months)', () => {
    const jobChunks = planArcpLoadJobChunks(longDetailOpts, postgresHints, { kind: 'detail' });
    const clientPlan = resolveArcpClientDetailLoadPlan(longDetailOpts, postgresHints);
    const summaryChunks = planArcpSummaryDateChunks(longDetailOpts, postgresHints);

    expect(jobChunks).toEqual(clientPlan.chunks);
    expect(jobChunks.length).toBeGreaterThan(summaryChunks.length);
  });

  it('estimates postgres detail time from chunks when CRM fallback is unused', () => {
    const plan = resolveArcpClientDetailLoadPlan(longDetailOpts, postgresHints);
    expect(plan.crmChunkCount).toBe(0);
    expect(plan.estimateMs).toBeGreaterThan(5000);
  });
});
