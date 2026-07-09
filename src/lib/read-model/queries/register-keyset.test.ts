import { describe, expect, it } from 'vitest';
import {
  buildWhere,
  hasRegisterKeysetCursor,
  registerKeysetCursorFromRow,
  REGISTER_HOT_ORDER_BY,
  type RegisterPostgresParams,
} from '@/lib/read-model/queries/register';

function baseParams(overrides: Partial<RegisterPostgresParams> = {}): RegisterPostgresParams {
  return {
    page: 1,
    limit: 2000,
    search: '',
    officeId: 'All',
    callType: 'All',
    startDate: '2026-01-01',
    endDate: '2026-07-08',
    status: '',
    account: '',
    region: '',
    pincode: '',
    priority: '',
    portalFilter: '',
    state: '',
    city: '',
    branch: '',
    franchisee: '',
    technician: '',
    fetchTotals: false,
    fetchFilterOptions: false,
    assignedOffices: [],
    visibleStatuses: [],
    isHod: true,
    ...overrides,
  };
}

describe('register composite keyset', () => {
  it('uses logged_at + ncode order constant', () => {
    expect(REGISTER_HOT_ORDER_BY).toBe('h.logged_at DESC, h.ncode DESC');
  });

  it('requires both cursor fields for keyset mode', () => {
    expect(hasRegisterKeysetCursor(baseParams())).toBe(false);
    expect(
      hasRegisterKeysetCursor(
        baseParams({ cursorNcode: 100, cursorLoggedAt: '2026-06-01T10:00:00.000Z' })
      )
    ).toBe(true);
    expect(hasRegisterKeysetCursor(baseParams({ cursorNcode: 100 }))).toBe(false);
  });

  it('builds composite tuple predicate in WHERE', () => {
    const { sql, values } = buildWhere(
      baseParams({
        cursorNcode: 42,
        cursorLoggedAt: '2026-06-01T10:00:00.000Z',
      })
    );
    expect(sql).toContain('h.logged_at <');
    expect(sql).toContain('h.ncode <');
    expect(values).toContain('2026-06-01T10:00:00.000Z');
    expect(values).toContain(42);
    expect(sql).not.toMatch(/h\.ncode < \$1\)/);
  });

  it('derives cursor from hot row shape', () => {
    const cursor = registerKeysetCursorFromRow({
      logged_at: new Date('2026-06-01T10:00:00.000Z'),
      ncode: 99,
    });
    expect(cursor).toEqual({
      cursorLoggedAt: '2026-06-01T10:00:00.000Z',
      cursorNcode: 99,
    });
  });

  it('derives cursor from register API row shape', () => {
    const cursor = registerKeysetCursorFromRow({
      callsdtrndate: '2026-06-01T10:00:00.000Z',
      id: 77,
    });
    expect(cursor).toEqual({
      cursorLoggedAt: '2026-06-01T10:00:00.000Z',
      cursorNcode: 77,
    });
  });
});
