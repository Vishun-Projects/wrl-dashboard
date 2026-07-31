/**
 * Characterization tripwires for export download filenames used across MIS Report tabs.
 * Keep names stable — live users and Outlook digests depend on these patterns.
 */
import { describe, expect, it } from 'vitest';
import { detailedMisRegisterFilename } from '@/features/register';
import {
  keyAccountMisFilename,
  summaryDashboardFilename,
} from '@/features/report/services/summary-excel-export';
import {
  bdMisOpenCallsFilename,
  bdMisSummaryFilename,
  bdMisTraceableFilename,
} from '@/features/report/services/bd-mis-excel-export';
import { callRegisterSerialExportFilename } from '@/features/report/services/call-register/dates';

const stamp = new Date('2026-07-27T12:00:00.000Z');

describe('portal export filenames', () => {
  it('locks MIS Summary / Key Account / Register Excel names', () => {
    expect(summaryDashboardFilename(stamp)).toBe('WRL Summary Dashboard — 2026-07-27.xlsx');
    expect(keyAccountMisFilename(stamp)).toBe('WRL Key Account MIS — 2026-07-27.xlsx');
    expect(detailedMisRegisterFilename(stamp)).toBe(
      'WRL Detailed MIS Register — 2026-07-27.xlsx'
    );
  });

  it('locks BD MIS workbook names used by ReportPageClient + digests', () => {
    expect(bdMisSummaryFilename(stamp)).toBe('WRL_BD_MIS_Summary_Audit_2026-07-27.xlsx');
    expect(bdMisTraceableFilename(stamp)).toBe('WRL_BD_MIS_Traceable_2026-07-27.xlsx');
    expect(bdMisOpenCallsFilename(stamp)).toBe('WRL_BD_MIS_Open_Calls_2026-07-27.xlsx');
  });

  it('locks Call Register serial export names (range vs all-time)', () => {
    expect(
      callRegisterSerialExportFilename(
        { dateFrom: '2026-07-01', dateTo: '2026-07-22' },
        stamp
      )
    ).toBe('WRL_Call_Register_Serials_2026-07-01_2026-07-22.xlsx');
    expect(callRegisterSerialExportFilename({}, stamp)).toBe(
      'WRL_Call_Register_Serials_AllTime_2026-07-27.xlsx'
    );
  });
});
