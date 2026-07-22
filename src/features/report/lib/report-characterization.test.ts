/**
 * Characterization tripwires for MIS report flows (load / filter key / export).
 * Gate before carving ReportPageClient — keep these green across the report feature move.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRegisterExportParams,
  shouldStreamRegisterExportFromServer,
  REGISTER_SERVER_STREAM_MIN_ROWS,
} from '@/features/register';
import { buildCorpusCacheKey } from '@/features/report/lib/corpus';
import { isExportActiveForTab, type ExportQueueItem } from '@/features/report/lib/export-queue';

const baseQuery = {
  officeId: 'All',
  callType: 'BREAKDOWN',
  startDate: '2026-07-01',
  endDate: '2026-07-22',
  dateFilterColumn: 'dtrndate',
};

describe('report characterization — register load params', () => {
  it('buildRegisterExportParams includes core filters and disables filter options', () => {
    const params = buildRegisterExportParams(
      { ...baseQuery, search: 'TRN1', status: 'OPEN', account: 'Coke' },
      2,
      50,
      true
    );
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('50');
    expect(params.get('officeId')).toBe('All');
    expect(params.get('callType')).toBe('BREAKDOWN');
    expect(params.get('startDate')).toBe('2026-07-01');
    expect(params.get('endDate')).toBe('2026-07-22');
    expect(params.get('search')).toBe('TRN1');
    expect(params.get('status')).toBe('OPEN');
    expect(params.get('account')).toBe('Coke');
    expect(params.get('fetchFilterOptions')).toBe('false');
    expect(params.get('fetchTotals')).toBeNull();
  });

  it('omits fetchTotals when false and attaches keyset cursor', () => {
    const params = buildRegisterExportParams(baseQuery, 1, 100, false, {
      cursorLoggedAt: '2026-07-10T00:00:00.000Z',
      cursorNcode: 99,
    });
    expect(params.get('fetchTotals')).toBe('false');
    expect(params.get('cursorLoggedAt')).toBe('2026-07-10T00:00:00.000Z');
    expect(params.get('cursorNcode')).toBe('99');
  });
});

describe('report characterization — filter / corpus key', () => {
  it('buildCorpusCacheKey is stable for the same view window + date column', () => {
    const a = buildCorpusCacheKey('2026-07-01', '2026-07-22', 'dtrndate');
    const b = buildCorpusCacheKey('2026-07-01', '2026-07-22', 'dtrndate');
    const c = buildCorpusCacheKey('2026-07-01', '2026-07-22', 'dsolvedatetime');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.split('|')).toHaveLength(3);
  });
});

describe('report characterization — export kickoff contracts', () => {
  it('streams CSV from server when total exceeds threshold and cache is incomplete', () => {
    expect(shouldStreamRegisterExportFromServer(REGISTER_SERVER_STREAM_MIN_ROWS + 1, 0)).toBe(
      true
    );
    expect(shouldStreamRegisterExportFromServer(10, 0)).toBe(false);
    expect(shouldStreamRegisterExportFromServer(1000, 1000)).toBe(false);
  });

  it('export queue active flag is tab-scoped', () => {
    const item: ExportQueueItem = {
      id: 'e1',
      label: 'Register CSV',
      status: 'running',
      enqueuedAt: Date.now(),
      sourceTab: 'register',
      kind: 'standard',
    };
    expect(isExportActiveForTab([item], 'register')).toBe(true);
    expect(isExportActiveForTab([item], 'summary')).toBe(false);
  });
});
