import { describe, expect, it } from 'vitest';
import { pickCancelledRegisterSource } from './postgres-sync';

describe('pickCancelledRegisterSource', () => {
  const mirrorMax = new Date('2026-08-31T08:00:00Z');
  const hotMax = new Date('2026-09-01T16:00:00Z');

  it('uses hot when mirror is backfilling', () => {
    expect(
      pickCancelledRegisterSource({
        mirrorStatus: 'backfilling',
        mirrorCancelledRows: 100,
        mirrorMaxCancelAt: mirrorMax,
        hotMaxCancelAt: hotMax,
      })
    ).toBe('hot');
  });

  it('uses hot when hot is fresher than mirror', () => {
    expect(
      pickCancelledRegisterSource({
        mirrorStatus: 'ok',
        mirrorCancelledRows: 100,
        mirrorMaxCancelAt: mirrorMax,
        hotMaxCancelAt: hotMax,
      })
    ).toBe('hot');
  });

  it('uses mirror when mirror is ok and at least as fresh as hot', () => {
    expect(
      pickCancelledRegisterSource({
        mirrorStatus: 'ok',
        mirrorCancelledRows: 100,
        mirrorMaxCancelAt: hotMax,
        hotMaxCancelAt: mirrorMax,
      })
    ).toBe('mirror');
  });

  it('uses hot when mirror has no cancelled rows', () => {
    expect(
      pickCancelledRegisterSource({
        mirrorStatus: 'ok',
        mirrorCancelledRows: 0,
        mirrorMaxCancelAt: null,
        hotMaxCancelAt: hotMax,
      })
    ).toBe('hot');
  });
});
