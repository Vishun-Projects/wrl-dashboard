import { describe, expect, it } from 'vitest';
import {
  assertRegisterCsvExportComplete,
  buildRegisterExportParams,
  countNewlinesInBytes,
  csvDataRowsFromNewlineCount,
  registerExportCursorFromRow,
  shouldStreamRegisterExportFromServer,
} from '@/features/register/lib/export-fetch';

describe('register export client helpers', () => {
  it('streams large exports from server', () => {
    expect(shouldStreamRegisterExportFromServer(273_572, 0)).toBe(true);
    expect(shouldStreamRegisterExportFromServer(100, 0)).toBe(false);
  });

  it('passes composite cursor params to API', () => {
    const params = buildRegisterExportParams(
      {
        officeId: 'All',
        callType: 'All',
        startDate: '2026-01-01',
        endDate: '2026-07-08',
        dateFilterColumn: 'dtrndate',
      },
      2,
      2000,
      false,
      { cursorLoggedAt: '2026-06-01T10:00:00.000Z', cursorNcode: 55 }
    );
    expect(params.get('cursorLoggedAt')).toBe('2026-06-01T10:00:00.000Z');
    expect(params.get('cursorNcode')).toBe('55');
  });

  it('does not set cursor params unless both fields are present', () => {
    const params = buildRegisterExportParams(
      {
        officeId: 'All',
        callType: 'All',
        startDate: '2026-01-01',
        endDate: '2026-07-08',
        dateFilterColumn: 'dtrndate',
      },
      2,
      2000,
      false,
      { cursorNcode: 55 }
    );
    expect(params.get('cursorLoggedAt')).toBeNull();
    expect(params.get('cursorNcode')).toBeNull();
  });

  it('derives export cursor from paginated row', () => {
    expect(
      registerExportCursorFromRow({
        callsdtrndate: '2026-06-01T10:00:00.000Z',
        ncode: 12,
      })
    ).toEqual({
      cursorLoggedAt: '2026-06-01T10:00:00.000Z',
      cursorNcode: 12,
    });
  });

  it('derives solved-date export cursor from paginated row', () => {
    expect(
      registerExportCursorFromRow(
        {
          callsolveddate: '2026-06-15T14:30:00.000Z',
          ncode: 12,
        },
        'dsolvedatetime'
      )
    ).toEqual({
      cursorLoggedAt: '2026-06-15T14:30:00.000Z',
      cursorNcode: 12,
    });
  });

  it('counts CSV data rows from newlines and rejects incomplete exports', () => {
    const chunk = new TextEncoder().encode('h1,h2\r\nr1,a\r\nr2,b\r\n');
    expect(countNewlinesInBytes(chunk)).toBe(3);
    expect(csvDataRowsFromNewlineCount(3)).toBe(2);
    expect(() => assertRegisterCsvExportComplete(2, 2)).not.toThrow();
    expect(() => assertRegisterCsvExportComplete(37_091, 293_443)).toThrow(/Export incomplete/);
  });
});
