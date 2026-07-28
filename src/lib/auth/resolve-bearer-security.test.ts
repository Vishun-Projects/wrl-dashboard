import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const createClient = vi.fn();
const resolveRequestUserId = vi.fn();
const resolveReportSecurity = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

vi.mock('@/lib/auth/server-user', () => ({
  resolveRequestUserId: (...args: unknown[]) => resolveRequestUserId(...args),
}));

vi.mock('@/lib/auth/report-security', () => ({
  resolveReportSecurity: (...args: unknown[]) => resolveReportSecurity(...args),
}));

const { requireRbac } = await import('@/lib/auth/resolve-bearer-security');

describe('requireRbac', () => {
  beforeEach(() => {
    createClient.mockReset();
    resolveRequestUserId.mockReset();
    resolveReportSecurity.mockReset();
    createClient.mockResolvedValue({});
  });

  it('returns 401 when no request user', async () => {
    resolveRequestUserId.mockResolvedValue(null);
    const result = await requireRbac(new NextRequest('http://localhost/api/report/summary'), {
      pageId: 'mis_reports',
      tabId: 'summary',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 403 when security forbids the page/tab', async () => {
    resolveRequestUserId.mockResolvedValue('u1');
    resolveReportSecurity.mockResolvedValue({ forbidden: true });
    const result = await requireRbac(new NextRequest('http://localhost/api/report/summary'), {
      pageId: 'mis_reports',
      tabId: 'summary',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns ok with userId when RBAC allows', async () => {
    resolveRequestUserId.mockResolvedValue('u1');
    resolveReportSecurity.mockResolvedValue({
      forbidden: false,
      assignedOffices: [],
    });
    const result = await requireRbac(new NextRequest('http://localhost/api/report/summary'), {
      pageId: 'mis_reports',
      tabId: 'summary',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.userId).toBe('u1');
  });
});
