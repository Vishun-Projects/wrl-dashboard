import { describe, expect, it } from 'vitest';
import {
  buildCancelledCallsFilterSql,
  istYesterdayYmd,
} from '@/modules/cancelled-calls/server/query';

const baseFilters = {
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  branches: [] as string[],
  franchisees: [] as string[],
  partyProfiles: [] as string[],
  callTypes: [] as string[],
  assignment: null,
  page: 1,
  pageSize: 50,
  isHod: false,
  assignedOffices: [] as string[],
};

describe('istYesterdayYmd', () => {
  it('returns previous IST calendar day', () => {
    expect(istYesterdayYmd(new Date('2026-08-26T10:00:00+05:30'))).toBe('2026-08-25');
    expect(istYesterdayYmd(new Date('2026-08-26T00:30:00+05:30'))).toBe('2026-08-25');
  });
});

describe('buildCancelledCallsFilterSql assignment', () => {
  it('filters assigned when branch and franchisee are set', () => {
    const { where } = buildCancelledCallsFilterSql({ ...baseFilters, assignment: 'assigned' });
    expect(where).toContain('branch_name');
    expect(where).toContain('franchisee_name');
    expect(where).toContain('UNALLOCATED');
  });

  it('filters unassigned when branch is set but franchisee is not', () => {
    const { where } = buildCancelledCallsFilterSql({ ...baseFilters, assignment: 'unassigned' });
    expect(where).toContain('NOT');
    expect(where).toContain('branch_name');
  });
});
