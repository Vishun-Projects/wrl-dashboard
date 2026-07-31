import { describe, expect, it } from 'vitest';
import { REGISTER_MSTPRORG_JOIN_SQL, SQL_WCO_EXPR } from '@/sql/register/wco';

describe('register WCO SQL', () => {
  it('joins mstprorg on nitemserialno', () => {
    expect(REGISTER_MSTPRORG_JOIN_SQL).toContain('LEFT JOIN mstprorg po');
    expect(REGISTER_MSTPRORG_JOIN_SQL).toContain('tc.nitemserialno = po.ncode');
  });

  it('derives W/C/O/V from warranty/contract/void with null when no prorg', () => {
    expect(SQL_WCO_EXPR).toContain("WHEN po.ncode IS NULL THEN NULL");
    expect(SQL_WCO_EXPR).toContain("THEN 'V'");
    expect(SQL_WCO_EXPR).toContain("THEN 'W'");
    expect(SQL_WCO_EXPR).toContain("THEN 'C'");
    expect(SQL_WCO_EXPR).toContain("ELSE 'O'");
    expect(SQL_WCO_EXPR).toContain('dwarrstartdate');
    expect(SQL_WCO_EXPR).toContain('dcontenddate');
    expect(SQL_WCO_EXPR).toContain('tc.dtrndate');
  });
});
