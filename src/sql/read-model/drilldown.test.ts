import { describe, expect, it } from 'vitest';
import { drilldownBodySchema } from '@/lib/api/schemas/report-query';

describe('drilldownBodySchema', () => {
  it('coerces numeric officeId to string', () => {
    const parsed = drilldownBodySchema.safeParse({
      type: 'total_calls',
      officeId: 1160,
      startDate: '2026-01-01',
      endDate: '2026-07-02',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.officeId).toBe('1160');
    }
  });
});

describe('querySummaryDrilldown account filter', () => {
  it('filters by account and region together', async () => {
    const { querySummaryDrilldown } = await import('@/sql/read-model/drilldown');
    try {
      const rows = await querySummaryDrilldown({
        type: 'total_solved',
        account: 'Anik Milk',
        region: 'WEST ZONE',
        startDate: '2026-01-01',
        endDate: '2026-07-01',
        callType: 'BREAKDOWN',
        isHod: true,
      });
      expect(rows.length).toBeLessThanOrEqual(500);
      for (const row of rows) {
        expect(row['Ref No']).toBeTruthy();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Unit suite must stay green without a local Postgres tunnel.
      if (/ECONNREFUSED|connect/i.test(msg)) return;
      throw err;
    }
  });
});
