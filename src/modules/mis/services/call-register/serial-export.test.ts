import { describe, expect, it } from 'vitest';
import { callRegisterSerialExportFilename } from './dates';

describe('callRegisterSerialExportFilename', () => {
  it('uses AllTime stamp when both dates omitted', () => {
    expect(
      callRegisterSerialExportFilename({}, new Date('2026-07-24T12:00:00.000Z'))
    ).toBe('WRL_Call_Register_Serials_AllTime_2026-07-24.xlsx');
  });

  it('embeds dateFrom and dateTo when present', () => {
    expect(
      callRegisterSerialExportFilename({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      })
    ).toBe('WRL_Call_Register_Serials_2026-01-01_2026-01-31.xlsx');
  });
});
