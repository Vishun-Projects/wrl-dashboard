import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseRegisterSearchParams } from '@/features/register/server/postgres-request';
import { rowForCsv, buildRegisterCsvContent } from '@/features/register/server/csv-export';
import { collectRegisterRowsFromSessionCache } from '@/features/register/services/export-fetch';
import { REGISTER_EXPORT_COLUMNS } from '@/features/register/services/table-columns';

describe('parseRegisterSearchParams', () => {
  it('defaults officeId=All and empty filters when query is bare', () => {
    const parsed = parseRegisterSearchParams(new URLSearchParams());
    expect(parsed.officeId).toBe('All');
    expect(parsed.search).toBe('');
    expect(parsed.status).toBe('');
    expect(parsed.account).toBe('');
    expect(parsed.priority).toBe('all');
    expect(parsed.portalFilter).toBe('All');
    expect(parsed.repair).toBe('All');
    expect(parsed.dateFilterColumn).toBe('dtrndate');
  });

  it('preserves core filter keys used by buildRegisterExportParams', () => {
    const parsed = parseRegisterSearchParams(
      new URLSearchParams({
        officeId: '101',
        callType: 'BREAKDOWN',
        startDate: '2026-07-01',
        endDate: '2026-07-22',
        dateFilterColumn: 'dtrndate',
        search: 'TRN1',
        status: 'OPEN',
        account: 'Coke',
      })
    );
    expect(parsed.officeId).toBe('101');
    expect(parsed.callType).toBe('BREAKDOWN');
    expect(parsed.startDate).toBe('2026-07-01');
    expect(parsed.endDate).toBe('2026-07-22');
    expect(parsed.search).toBe('TRN1');
    expect(parsed.status).toBe('OPEN');
    expect(parsed.account).toBe('Coke');
  });
});

describe('register CSV export mapping', () => {
  it('rowForCsv exposes required export columns including status', () => {
    const mapped = rowForCsv({
      UniqueCallNo: 'TRN9',
      calltype: 'BREAKDOWN',
      callsdtrndate: '2026-07-01',
      PartyName: 'Acme',
      officename: 'Mumbai',
      callstatus: 'OPEN',
      Status: 'OPEN',
    });
    for (const col of REGISTER_EXPORT_COLUMNS) {
      expect(mapped).toHaveProperty(col.key);
    }
    expect(mapped.display_status).toBeTruthy();
    expect(mapped.UniqueCallNo).toBe('TRN9');
  });

  it('buildRegisterCsvContent starts with export headers', () => {
    const csv = buildRegisterCsvContent([]);
    const header = csv.split(/\r?\n/)[0];
    expect(header).toContain('ID');
    expect(header).toContain('Call Type');
    expect(header).toContain('Status');
  });
});

describe('collectRegisterRowsFromSessionCache', () => {
  it('returns rows only when every page is cached and length covers total', () => {
    const root = new Map<string, Map<number, { data?: unknown[] }>>();
    const pages = new Map<number, { data?: unknown[] }>();
    pages.set(1, { data: [{ id: 1 }, { id: 2 }] });
    pages.set(2, { data: [{ id: 3 }] });
    root.set('q', pages);

    expect(collectRegisterRowsFromSessionCache(root, 'q', 3, 2)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
  });

  it('returns null when a page is missing (forces network export)', () => {
    const root = new Map<string, Map<number, { data?: unknown[] }>>();
    const pages = new Map<number, { data?: unknown[] }>();
    pages.set(1, { data: [{ id: 1 }] });
    root.set('q', pages);
    expect(collectRegisterRowsFromSessionCache(root, 'q', 3, 2)).toBeNull();
  });
});
