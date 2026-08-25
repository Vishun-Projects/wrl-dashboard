import { describe, expect, it } from 'vitest';
import {
  buildCorpusFieldsSql,
  resolveRegisterDateSqlColumn,
  sqlRegisterDateColumn,
  sqlRegisterDateColumnBare,
  sqlRegisterBmApprovalPredicate,
  REGISTER_DATE_FILTER_OPTIONS,
} from '@/sql/trhcalls/query';

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

describe('register Cancelled At date filter', () => {
  it('exposes Cancelled At in filter options', () => {
    expect(REGISTER_DATE_FILTER_OPTIONS.some((o) => o.value === 'cancelled_at')).toBe(true);
  });

  it('resolves and maps Cancelled At to CRM editedon', () => {
    expect(resolveRegisterDateSqlColumn('cancelled_at')).toBe('cancelled_at');
    expect(sqlRegisterDateColumn('cancelled_at')).toBe('tc.editedon');
    expect(sqlRegisterDateColumnBare('cancelled_at')).toBe('editedon');
  });

  it('includes cancelled_at field in corpus payload SQL', () => {
    const sql = buildCorpusFieldsSql();
    expect(sql).toContain('AS cancelled_at');
  });
});
