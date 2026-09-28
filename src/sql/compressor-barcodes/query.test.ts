import { describe, expect, it } from 'vitest';
import {
  buildCompressorBarcodesListRawSql,
  buildGasChargingListRawSql,
  buildGasChargingSerialsSql,
  buildRepeatCallsModifiedSerialsSql,
  parseRepeatCallKind,
  parseRepeatDateColumn,
  pushRepeatDateRangeSql,
  repeatKindFilterSql,
} from './query';

describe('parseRepeatCallKind', () => {
  it('defaults to compressor', () => {
    expect(parseRepeatCallKind(null)).toBe('compressor');
    expect(parseRepeatCallKind('')).toBe('compressor');
    expect(parseRepeatCallKind('repeat')).toBe('compressor');
  });

  it('accepts gas', () => {
    expect(parseRepeatCallKind('gas')).toBe('gas');
  });
});

describe('pushRepeatDateRangeSql', () => {
  it('is empty without dates', () => {
    const params: unknown[] = [];
    expect(pushRepeatDateRangeSql('call_date', '', '', params)).toBe('');
    expect(params).toEqual([]);
  });

  it('binds a closed window after existing params', () => {
    const params: unknown[] = [['DELHI']];
    const sql = pushRepeatDateRangeSql('solve_date', '2026-08-01', '2026-09-28', params);
    expect(sql).toBe(
      "solve_date >= $2::timestamptz AND solve_date <= ($3::date + INTERVAL '1 day')"
    );
    expect(params).toEqual([['DELHI'], '2026-08-01', '2026-09-28']);
  });
});

describe('parseRepeatDateColumn', () => {
  it('defaults to call_date', () => {
    expect(parseRepeatDateColumn(null)).toBe('call_date');
    expect(parseRepeatDateColumn('solve_date')).toBe('solve_date');
  });
});

describe('repeatKindFilterSql', () => {
  it('allowlists kind for interpolation', () => {
    expect(repeatKindFilterSql('compressor')).toBe(
      "COALESCE(repair_kind, 'compressor') = 'compressor'"
    );
    expect(repeatKindFilterSql('gas')).toBe("COALESCE(repair_kind, 'compressor') = 'gas'");
  });
});

describe('CRM repeat-call SQL', () => {
  it('keeps compressor list on nrepair 19', () => {
    const sql = buildCompressorBarcodesListRawSql();
    expect(sql).toContain('f.nrepair = 19');
    expect(sql).not.toContain('Gas Charging Done');
  });

  it('lists distinct gas-charging serials without paging', () => {
    const sql = buildGasChargingSerialsSql();
    expect(sql).toContain("LTRIM(RTRIM(r.vname)) = 'Gas Charging Done'");
    expect(sql).toContain('SELECT DISTINCT tc.vserialno');
    expect(sql).not.toContain('OFFSET');
  });

  it('lists gas charging by repair name without barcode joins', () => {
    const sql = buildGasChargingListRawSql({ serials: ['ABC-1'] });
    expect(sql).toContain("LTRIM(RTRIM(r.vname)) = 'Gas Charging Done'");
    expect(sql).toContain("'ABC-1'");
    expect(sql).not.toContain('trdcalls3parts');
    expect(sql).not.toContain('nrepair = 19');
  });

  it('unions compressor and gas modified serials', () => {
    const sql = buildRepeatCallsModifiedSerialsSql('2026-01-01 00:00:00');
    expect(sql).toContain('f.nrepair = 19');
    expect(sql).toContain('Gas Charging Done');
    expect(sql).toContain('UNION');
  });
});
