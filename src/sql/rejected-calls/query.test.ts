import { describe, expect, it } from 'vitest';
import {
  BM_REJECT_SQL,
  HO_REJECT_SQL,
  buildRejectedCallsListSql,
  buildRejectedCallsSummarySql,
  buildRejectedCallsWhereSql,
} from './query';

const base = {
  startDate: '2026-09-01',
  endDate: '2026-09-28',
  source: null as null,
  isHod: true,
  assignedOffices: [] as string[],
};

describe('rejected-calls CRM SQL', () => {
  it('requires currently rejected HO or BM flags, not merely NOT NULL', () => {
    const where = buildRejectedCallsWhereSql(base);
    expect(where).toContain(HO_REJECT_SQL);
    expect(where).toContain(BM_REJECT_SQL);
    expect(where).not.toMatch(/bhoreject IS NOT NULL/i);
  });

  it('HO filter drops BM-only rows; Branch filter drops active HO', () => {
    const ho = buildRejectedCallsWhereSql({ ...base, source: 'HO' });
    expect(ho).toContain(HO_REJECT_SQL);
    expect(ho).not.toContain(`OR ${BM_REJECT_SQL}`);

    const branch = buildRejectedCallsWhereSql({ ...base, source: 'Branch' });
    expect(branch).toContain(BM_REJECT_SQL);
    expect(branch).toContain(`NOT ${HO_REJECT_SQL}`);
  });

  it('pages with OFFSET FETCH and counts in the same list query', () => {
    const sql = buildRejectedCallsListSql({ ...base, offset: 50, limit: 25 });
    expect(sql).toMatch(/OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY/i);
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain('vhorejectreason');
    expect(sql).toContain('trdcalls2fault');
  });

  it('restricts non-HOD users to assigned offices', () => {
    const sql = buildRejectedCallsWhereSql({
      ...base,
      isHod: false,
      assignedOffices: ['101', '202'],
    });
    expect(sql).toContain('tc.nofficeid IN (101,202)');
  });

  it('applies office ids (branch or franchisee) to the call office', () => {
    const where = buildRejectedCallsWhereSql({
      ...base,
      officeId: '1173,4455',
      dateFilterColumn: 'dtrndate',
    });
    expect(where).toContain('tc.nofficeid IN (1173,4455)');
    expect(where).toContain('o.nunder IN (1173,4455)');
    expect(where).toContain('tc.dtrndate');
  });

  it('filters rejection reason groups by tokens, not exact labels', () => {
    const where = buildRejectedCallsWhereSql({
      ...base,
      reasons: ['wrong photo', '(blank)'],
    });
    expect(where).toContain("LIKE '%WRONG%'");
    expect(where).toContain("LIKE '%PHOTO%'");
    expect(where).toContain('IS NULL');
    expect(where).not.toContain("'wrong photo'");
  });

  it('summary cards omit call-type and reason filters', () => {
    const sql = buildRejectedCallsSummarySql({
      ...base,
      callType: 'BREAKDOWN',
      reasons: ['Wrong part'],
      officeId: '4455',
    });
    expect(sql).toContain("kind");
    expect(sql).toContain('call_type');
    expect(sql).toContain('reason');
    expect(sql).toContain('tc.nofficeid = 4455');
    expect(sql).not.toContain("vdisplayvalue IN ('BREAKDOWN')");
    expect(sql).not.toContain("'Wrong part'");
  });

  it('applies repair-done EXISTS on list and summary', () => {
    const where = buildRejectedCallsWhereSql({ ...base, repair: '19' });
    expect(where).toContain('trdcalls2fault');
    expect(where).toContain('tf.nrepair IN (19)');

    const none = buildRejectedCallsWhereSql(base);
    expect(none).not.toContain('tf.nrepair');

    const summary = buildRejectedCallsSummarySql({
      ...base,
      repair: '19',
      callType: 'BREAKDOWN',
    });
    expect(summary).toContain('tf.nrepair IN (19)');
    expect(summary).not.toContain("vdisplayvalue IN ('BREAKDOWN')");
  });
});
