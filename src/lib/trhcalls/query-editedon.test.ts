import { describe, expect, it } from 'vitest';
import {
  buildTrhcallsEditedonDaySubquery,
  buildTrhcallsWatermarkWhere,
  TRHCALLS_EDITED_ONLY_WHERE,
} from '@/lib/trhcalls/query';

describe('buildTrhcallsWatermarkWhere', () => {
  it('uses ISNULL(editedon, addedon) for incremental fetch', () => {
    const sql = buildTrhcallsWatermarkWhere('2026-06-30 00:00:00');
    expect(sql).toBe("ISNULL(editedon, addedon) >= '2026-06-30 00:00:00'");
  });
});

describe('buildTrhcallsEditedonDaySubquery', () => {
  it('filters editedon day window with addedon <> editedon', () => {
    const sql = buildTrhcallsEditedonDaySubquery('2026-06-30', '2026-06-30');
    expect(sql).toContain("editedon >= '2026-06-30 00:00:00'");
    expect(sql).toContain("editedon <= '2026-06-30 23:59:59'");
    expect(sql).toContain(TRHCALLS_EDITED_ONLY_WHERE);
  });
});
