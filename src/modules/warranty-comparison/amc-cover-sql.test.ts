import { describe, expect, it } from 'vitest';
import { amcCoverSql, coverageSql } from './exception-cover';

describe('amcCoverSql', () => {
  it('negated form excludes AMC-covered rows', () => {
    const sql = amcCoverSql(true);
    expect(sql.startsWith('AND NOT')).toBe(true);
    expect(sql).toContain('warranty_exception_accounts');
    expect(sql).toContain('e.amc');
  });

  it('positive form requires AMC cover', () => {
    const sql = amcCoverSql(false);
    expect(sql).toContain('AND EXISTS');
    expect(sql).toContain('amc_valid_upto');
  });
});

describe('coverageSql', () => {
  it('skips filter for in_warr_oow', () => {
    expect(coverageSql('in_warr_oow', 3)).toBe('');
  });

  it('includes or excludes vtrnno list by tab', () => {
    expect(coverageSql('exception_ok', 4)).toContain('= ANY($4');
    expect(coverageSql('oow_in_warr', 4)).toContain('NOT');
  });
});
