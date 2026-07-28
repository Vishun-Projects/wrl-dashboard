import { describe, expect, it } from 'vitest';
import { buildRegisterExcelWorkbook } from '@/features/register/lib/excel-export';

describe('buildRegisterExcelWorkbook', () => {
  it('writes expected headers and one data row', async () => {
    const workbook = await buildRegisterExcelWorkbook([
      {
        UniqueCallNo: 'TRN1',
        vcclid: 'CC1',
        calltype: 'BREAKDOWN',
        callsdtrndate: '2026-07-01',
        PartyName: 'Acme',
        officename: 'Delhi',
        region: 'NORTH',
        account: 'Nestle',
        callstatus: 'OPEN',
        Status: 'OPEN',
      },
    ]);

    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('Call Register');
    expect(sheet.getRow(1).getCell(1).value).toBe('ID');
    expect(sheet.getRow(1).getCell(3).value).toBe('Call Type');
    expect(sheet.getRow(1).getCell(6).value).toBe('Customer');
    expect(sheet.rowCount).toBeGreaterThanOrEqual(2);
    expect(String(sheet.getRow(2).getCell(1).value)).toContain('TRN1');
  }, 20_000);
});
