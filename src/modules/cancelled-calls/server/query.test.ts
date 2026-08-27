import { describe, expect, it } from 'vitest';
import { istYesterdayYmd } from '@/modules/cancelled-calls/server/query';

describe('istYesterdayYmd', () => {
  it('returns previous IST calendar day', () => {
    expect(istYesterdayYmd(new Date('2026-08-26T10:00:00+05:30'))).toBe('2026-08-25');
    expect(istYesterdayYmd(new Date('2026-08-26T00:30:00+05:30'))).toBe('2026-08-25');
  });
});
