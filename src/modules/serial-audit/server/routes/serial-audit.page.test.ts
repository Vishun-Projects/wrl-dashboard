import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const resolveReportSecurity = vi.fn();
const postQuery = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/auth/report-security', () => ({
  resolveReportSecurity: (...args: unknown[]) => resolveReportSecurity(...args),
}));

vi.mock('@/lib/db/proxy', () => ({
  postQuery: (...args: unknown[]) => postQuery(...args),
}));

vi.mock('@/sql/serial-audit/sql-scope', () => ({
  resolveSerialAuditSqlOpts: vi.fn(async () => ({
    callType: null,
    repair: null,
    franchisee: null,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    isHod: true,
    assignedOffices: [],
  })),
}));

vi.mock('@/modules/serial-audit/server/batch-fetch', () => ({
  fetchSerialAuditCallsForSerials: vi.fn(),
  flaggedSerialsFromListRows: vi.fn(() => []),
}));

describe('GET /api/report/serial-audit list pagination', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    resolveReportSecurity.mockReset();
    postQuery.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'u1', email: 'a@example.com' });
    resolveReportSecurity.mockResolvedValue({
      forbidden: false,
      isHod: true,
      assignedOffices: [],
    });
  });

  it('returns page + total for list mode', async () => {
    postQuery
      .mockResolvedValueOnce({
        data: [
          { serial: 'AAA', complaint_count: 5 },
          { serial: 'BBB', complaint_count: 4 },
        ],
      })
      .mockResolvedValueOnce({
        data: [{ total: 42 }],
      });

    const { GET } = await import('@/modules/serial-audit/server/routes/serial-audit');
    const res = await GET(
      new Request(
        'http://localhost/api/report/serial-audit?startDate=2026-01-01&endDate=2026-01-31&page=2&limit=25&search=AA&minRepeats=3'
      ) as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.limit).toBe(25);
    expect(body.total).toBe(42);
    expect(body.serials).toHaveLength(2);
    expect(postQuery).toHaveBeenCalledTimes(2);
    const pageSql = String(postQuery.mock.calls[0][0].rawSql);
    const countSql = String(postQuery.mock.calls[1][0].rawSql);
    expect(pageSql).toMatch(/OFFSET 25 ROWS FETCH NEXT 25 ROWS ONLY/i);
    expect(pageSql).toContain("listed.serial LIKE '%AA%'");
    expect(pageSql).toMatch(/HAVING COUNT\(\*\) >= 3/i);
    expect(countSql).toMatch(/SELECT COUNT\(\*\) AS total/i);
  });

  it('export=1 returns unpaged list without a separate count query', async () => {
    postQuery.mockResolvedValueOnce({
      data: [{ serial: 'AAA', complaint_count: 5 }],
    });

    const { GET } = await import('@/modules/serial-audit/server/routes/serial-audit');
    const res = await GET(
      new Request(
        'http://localhost/api/report/serial-audit?startDate=2026-01-01&endDate=2026-01-31&export=1'
      ) as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.export).toBe(true);
    expect(body.serials).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(postQuery).toHaveBeenCalledTimes(1);
  });
});
