import { describe, expect, it } from 'vitest';
import {
  parseRepairQueryParam,
  serializeRepairFilterParam,
} from '@/modules/serial-history';
import {
  buildRepairNcodeExistsWhere,
  buildRegisterCallIdsWithRepairSql,
  buildRegisterRepairDoneByCallKeysSql,
  buildRegisterRepairNcodeExistsWhere,
} from '@/sql/trhcalls/query';

describe('register repair filter', () => {
  it('round-trips ncode lists through serialize/parse', () => {
    expect(serializeRepairFilterParam([])).toBe('All');
    expect(parseRepairQueryParam('All')).toEqual([]);
    expect(parseRepairQueryParam('')).toEqual([]);
    expect(parseRepairQueryParam(null)).toEqual([]);

    const values = ['12', '34', '56'];
    const serialized = serializeRepairFilterParam(values);
    expect(serialized).toBe('12,34,56');
    expect(parseRepairQueryParam(serialized)).toEqual(values);
  });

  it('builds EXISTS SQL for ncodes and null for empty/All', () => {
    expect(buildRepairNcodeExistsWhere('All', 'tc')).toBeNull();
    expect(buildRepairNcodeExistsWhere('', 'tc')).toBeNull();
    expect(buildRepairNcodeExistsWhere(null, 'tc')).toBeNull();

    const sql = buildRepairNcodeExistsWhere('12,34', 'tc');
    expect(sql).toContain('EXISTS (');
    expect(sql).toContain('trdcalls2fault');
    expect(sql).toContain('tf.nrepair IN (12,34)');
    expect(sql).toContain('tf.ncalls = tc.ncode');
    expect(sql).toContain('tf.nofficeid = tc.nofficeid');
    expect(sql).not.toContain('mstrepair');
  });

  it('register repair EXISTS also requires Assigned / Tech Solved / Solved', () => {
    const sql = buildRegisterRepairNcodeExistsWhere('19', 'tc');
    expect(sql).toContain('tf.nrepair IN (19)');
    expect(sql).toContain('tc.nengineer');
    expect(sql).toContain('tc.bfastclose');
    expect(sql).toContain('tc.bsolved');
    expect(sql).toContain('tc.ncancelreason');
  });

  it('builds lean register call-id SQL for repair filter', () => {
    expect(buildRegisterCallIdsWithRepairSql({ repair: 'All' })).toBeNull();

    const sql = buildRegisterCallIdsWithRepairSql({
      repair: '19',
      startDate: '2026-07-01',
      endDate: '2026-07-20',
      dateFilterColumn: 'dtrndate',
      isHod: true,
    });
    expect(sql).toContain('tf.nrepair IN (19)');
    expect(sql).toContain('tc.nengineer');
    expect(sql).toContain('tc.bfastclose');
    expect(sql).toContain('tc.bsolved');
    expect(sql).toContain("tc.dtrndate >= '2026-07-01'");
    expect(sql).toContain("tc.dtrndate <= '2026-07-20 23:59:59'");
    expect(sql).toContain('SELECT DISTINCT tf.ncalls AS call_ncode, tf.nofficeid AS call_office_id');
  });

  it('builds repair_done select keyed by call ncode + office', () => {
    expect(buildRegisterRepairDoneByCallKeysSql([])).toBeNull();
    expect(
      buildRegisterRepairDoneByCallKeysSql([{ ncode: -1, officeId: 1 }, { ncode: 1, officeId: 0 }])
    ).toBeNull();

    const sql = buildRegisterRepairDoneByCallKeysSql([
      { ncode: 2088, officeId: 454 },
      { ncode: 2088, officeId: 150 },
      { ncode: 2088, officeId: 454 },
    ]);
    expect(sql).toContain('INNER JOIN (VALUES (2088,454),(2088,150)) AS keys(ncalls, nofficeid)');
    expect(sql).toContain('GROUP BY tf.ncalls, tf.nofficeid');
    expect(sql).toContain('has_motor');
    expect(sql).toContain('Motor Replaced');
    expect(sql).toContain('Compressor Replaced');
    expect(sql).toContain('Gas Charging Done');
  });
});
