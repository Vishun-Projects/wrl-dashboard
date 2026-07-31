import { describe, expect, it } from 'vitest';
import {
  assertRegisterCsvExportComplete,
  buildRegisterExportParams,
  countNewlinesInBytes,
  csvDataRowsFromNewlineCount,
  registerExportCursorFromRow,
  resolveRegisterCsvExportUrl,
  shouldStreamRegisterExportFromServer,
  splitRegisterExportDateShards,
  stripCsvBomAndHeader,
} from '@/modules/mis/register/services/export-fetch';

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

  it('does not route to VPS unless NEXT_PUBLIC_REGISTER_CSV_VPS=1', () => {
    const prevUrl = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    const prevFlag = process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    delete process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
    try {
      const params = new URLSearchParams({ export: 'csv', startDate: '2026-01-01' });
      const { url, external } = resolveRegisterCsvExportUrl(params);
      expect(external).toBe(false);
      expect(url.startsWith('/api/report?')).toBe(true);
    } finally {
      if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
      else process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL = prevUrl;
      if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
      else process.env.NEXT_PUBLIC_REGISTER_CSV_VPS = prevFlag;
    }
  });

  it('routes large register CSV to the VPS host when flag + MIS upload URL are set', () => {
    const prevUrl = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    const prevFlag = process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    process.env.NEXT_PUBLIC_REGISTER_CSV_VPS = '1';
    try {
      const params = new URLSearchParams({ export: 'csv', startDate: '2026-01-01' });
      const { url, external } = resolveRegisterCsvExportUrl(params);
      expect(external).toBe(true);
      expect(url).toContain('https://api.wrl-fsm.cloud/api/report/register-export?');
      expect(url).toContain('export=csv');
    } finally {
      if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
      else process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL = prevUrl;
      if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
      else process.env.NEXT_PUBLIC_REGISTER_CSV_VPS = prevFlag;
    }
  });

  it('keeps repair-filter exports on same-origin', () => {
    const prev = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    const prevFlag = process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    process.env.NEXT_PUBLIC_REGISTER_CSV_VPS = '1';
    try {
      const params = new URLSearchParams({ export: 'csv', repair: '1,2' });
      const { url, external } = resolveRegisterCsvExportUrl(params);
      expect(external).toBe(false);
      expect(url.startsWith('/api/report?')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
      else process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL = prev;
      if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_REGISTER_CSV_VPS;
      else process.env.NEXT_PUBLIC_REGISTER_CSV_VPS = prevFlag;
    }
  });

  it('splits export dates into week-sized shards', () => {
    const shards = splitRegisterExportDateShards('2026-01-01', '2026-01-20', {
      maxDaysPerShard: 7,
    });
    expect(shards).toEqual([
      { startDate: '2026-01-01', endDate: '2026-01-07' },
      { startDate: '2026-01-08', endDate: '2026-01-14' },
      { startDate: '2026-01-15', endDate: '2026-01-20' },
    ]);
  });

  it('strips BOM and header from a CSV shard body', () => {
    const raw = new TextEncoder().encode('\uFEFFh1,h2\r\nr1,a\r\nr2,b\r\n');
    const stripped = stripCsvBomAndHeader(raw);
    expect(new TextDecoder().decode(stripped)).toBe('r1,a\r\nr2,b\r\n');
  });
});
