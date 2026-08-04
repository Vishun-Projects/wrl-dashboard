import { describe, expect, it } from 'vitest';
import {
  buildSerialAuditWindowListCountRawSql,
  buildSerialAuditWindowListRawSql,
} from '@/sql/trhcalls/query';

const baseOpts = {
  callType: null as string | null,
  repair: null as string | null,
  franchisee: null as string | null,
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  isHod: true,
  assignedOffices: [] as string[],
  minRepeats: 2,
};

describe('serial audit list SQL pagination', () => {
  it('adds ORDER BY + OFFSET/FETCH for a page', () => {
    const sql = buildSerialAuditWindowListRawSql({
      ...baseOpts,
      offset: 25,
      limit: 25,
    });
    expect(sql).toMatch(/HAVING COUNT\(\*\) >= 2/i);
    expect(sql).toMatch(/ORDER BY listed\.complaint_count DESC, listed\.serial ASC/i);
    expect(sql).toMatch(/OFFSET 25 ROWS FETCH NEXT 25 ROWS ONLY/i);
  });

  it('applies serial search on the aggregated list', () => {
    const sql = buildSerialAuditWindowListRawSql({
      ...baseOpts,
      serialSearch: "AB'C",
      offset: 0,
      limit: 25,
    });
    expect(sql).toContain("listed.serial LIKE '%AB''C%'");
  });

  it('builds a matching count query with search + having', () => {
    const sql = buildSerialAuditWindowListCountRawSql({
      ...baseOpts,
      serialSearch: 'XYZ',
      minRepeats: 3,
    });
    expect(sql).toMatch(/SELECT COUNT\(\*\) AS total/i);
    expect(sql).toMatch(/HAVING COUNT\(\*\) >= 3/i);
    expect(sql).toContain("listed.serial LIKE '%XYZ%'");
    expect(sql).not.toMatch(/OFFSET/i);
  });
});
