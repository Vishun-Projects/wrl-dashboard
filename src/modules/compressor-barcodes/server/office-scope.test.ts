import { describe, expect, it } from 'vitest';
import { compressorBranchScopeClause } from './office-scope';

describe('compressorBranchScopeClause', () => {
  it('emits no SQL when unrestricted', () => {
    expect(compressorBranchScopeClause(null, 1)).toEqual({
      sql: '',
      values: [],
      nextIdx: 1,
    });
  });

  it('scopes branch_name to allowed names including parent branch labels', () => {
    const r = compressorBranchScopeClause(['1173 - DELHI BRANCH', '1163 - JAIPUR BRANCH'], 2);
    expect(r.sql).toBe(' AND branch_name = ANY($2::text[])');
    expect(r.values).toEqual([['1173 - DELHI BRANCH', '1163 - JAIPUR BRANCH']]);
    expect(r.nextIdx).toBe(3);
  });
});
