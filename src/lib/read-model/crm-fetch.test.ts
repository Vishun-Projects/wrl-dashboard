import { describe, expect, it } from 'vitest';
import { planCrmIncrementalChunks } from './crm-fetch';

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
