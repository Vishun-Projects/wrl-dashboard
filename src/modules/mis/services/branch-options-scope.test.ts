import { describe, expect, it } from 'vitest';
import { buildMainBranchOptions } from '@/modules/mis/services/filters';

describe('buildMainBranchOptions office scope', () => {
  it('drops cascade branches outside scoped offices', () => {
    const offices = [{ ncode: '8', vcompanyname: '1173 - DELHI BRANCH' }];
    const branchesList = [
      { ncode: '8', vcompanyname: '1173 - DELHI BRANCH' },
      { ncode: '15', vcompanyname: '1152 - BANGALORE BRANCH' },
    ];
    const opts = buildMainBranchOptions(offices, branchesList);
    expect(opts.map((o) => o.value)).toEqual(['8']);
  });

  it('does not use cascade list when offices empty', () => {
    const opts = buildMainBranchOptions([], [
      { ncode: '15', vcompanyname: '1152 - BANGALORE BRANCH' },
    ]);
    expect(opts).toEqual([]);
  });
});
