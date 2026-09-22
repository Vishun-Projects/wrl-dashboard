import { describe, expect, it } from 'vitest';
import { scopeAttendanceOfficeIds } from './office-scope';

describe('scopeAttendanceOfficeIds', () => {
  it('passes through when unrestricted', () => {
    expect(scopeAttendanceOfficeIds([1, 2], null)).toEqual([1, 2]);
  });

  it('forces allowed when client sends none', () => {
    expect(scopeAttendanceOfficeIds([], [10, 20])).toEqual([10, 20]);
  });

  it('intersects client selection with allowed', () => {
    expect(scopeAttendanceOfficeIds([10, 99], [10, 20])).toEqual([10]);
  });
});
