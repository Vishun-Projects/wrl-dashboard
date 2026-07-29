import { describe, expect, it } from 'vitest';
import {
  resolveRegisterDateSqlColumn,
  sqlRegisterDateColumn,
  sqlRegisterDateColumnBare,
  sqlRegisterBmApprovalPredicate,
  REGISTER_DATE_FILTER_OPTIONS,
} from '@/lib/trhcalls/query';

describe('register BM approved date filter', () => {
  it('exposes BM Approved Date in filter options', () => {
    expect(REGISTER_DATE_FILTER_OPTIONS.some((o) => o.value === 'bm_approved_at')).toBe(true);
  });

  it('resolves and maps BM column to CRM editedon + bapproval', () => {
    expect(resolveRegisterDateSqlColumn('bm_approved_at')).toBe('bm_approved_at');
    expect(sqlRegisterDateColumn('bm_approved_at')).toBe('tc.editedon');
    expect(sqlRegisterDateColumnBare('bm_approved_at')).toBe('editedon');
    expect(sqlRegisterBmApprovalPredicate('tc')).toContain('bapproval');
  });
});
