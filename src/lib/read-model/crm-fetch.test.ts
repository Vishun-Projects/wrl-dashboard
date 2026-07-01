import { describe, expect, it } from 'vitest';
import { planCrmIncrementalChunks, planCrmIncrementalEditedonDelta } from './crm-fetch';

describe('planCrmIncrementalEditedonDelta', () => {
  it('returns editedon watermark without dtrndate chunk bounds', () => {
    const watermark = new Date('2026-06-30T18:29:59.000Z');
    const plan = planCrmIncrementalEditedonDelta(watermark);

    expect(plan.watermark).toBeTruthy();
    expect(plan.estimatedCrmRequests).toBeGreaterThan(0);
    expect(plan.catchUpDays).toBeGreaterThanOrEqual(0);
  });
});

describe('planCrmIncrementalChunks', () => {
  it('returns chunk plan with watermark and date bounds', () => {
    const watermark = new Date('2026-06-20T10:00:00.000Z');
    const plan = planCrmIncrementalChunks(watermark);

    expect(plan.watermark).toBeTruthy();
    expect(plan.startDate).toBeTruthy();
    expect(plan.endDate).toBeTruthy();
    expect(plan.chunks.length).toBeGreaterThan(0);
    expect(plan.estimatedCrmRequests).toBeGreaterThan(0);
  });
});
