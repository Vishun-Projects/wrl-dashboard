import { describe, expect, it } from 'vitest';

const CANCELLED_WHERE = `
  COALESCE(t.ncancelreason, 0) NOT IN (0, 2)
  OR t.status_bucket = 'cancelled'
`;

describe('cancelled register postgres sync', () => {
  it('targets real cancels only', () => {
    expect(CANCELLED_WHERE).toContain('ncancelreason');
    expect(CANCELLED_WHERE).toContain("status_bucket = 'cancelled'");
  });
});
