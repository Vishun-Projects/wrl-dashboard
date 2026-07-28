import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const queryRawUnsafe = vi.fn();
const loadDigestRecipientById = vi.fn();
const resolveUserDigestScopeWithLabel = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
  },
}));

vi.mock('@/features/mis-email/lib/recipients', () => ({
  loadDigestRecipientById: (...args: unknown[]) => loadDigestRecipientById(...args),
}));

vi.mock('@/features/mis-email/lib/user-scope', () => ({
  resolveUserDigestScopeWithLabel: (...args: unknown[]) =>
    resolveUserDigestScopeWithLabel(...args),
}));

const { GET } = await import('@/app/api/profile/mis-email/route');

function baseRow() {
  return {
    mis_email_enabled: false,
    mis_email_preferences: {},
    role_name: 'Mail access',
  };
}

describe('GET /api/profile/mis-email access flags', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    queryRawUnsafe.mockReset();
    loadDigestRecipientById.mockReset();
    resolveUserDigestScopeWithLabel.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'u1', email: 'u@example.com' });
    queryRawUnsafe.mockResolvedValue([baseRow()]);
    resolveUserDigestScopeWithLabel.mockResolvedValue({
      scopeLabel: 'All branches',
    });
  });

  it('mail-only → can_access_email_ui true, has_report_access false', async () => {
    loadDigestRecipientById.mockResolvedValue({
      id: 'u1',
      permissions: ['mis_email_send'],
      includeSummary: false,
      includeDetailed: false,
      includeKeyAccount: false,
    });

    const res = await GET(new Request('http://localhost/api/profile/mis-email'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_access_email_ui).toBe(true);
    expect(body.has_report_access).toBe(false);
    expect(resolveUserDigestScopeWithLabel).not.toHaveBeenCalled();
  });

  it('summary without mail → can_access_email_ui false, has_report_access true', async () => {
    loadDigestRecipientById.mockResolvedValue({
      id: 'u1',
      permissions: ['tab_mis_summary'],
      includeSummary: true,
      includeDetailed: false,
      includeKeyAccount: false,
    });

    const res = await GET(new Request('http://localhost/api/profile/mis-email'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_access_email_ui).toBe(false);
    expect(body.has_report_access).toBe(true);
  });

  it('mail + summary → both flags true', async () => {
    loadDigestRecipientById.mockResolvedValue({
      id: 'u1',
      permissions: ['mis_email_send', 'tab_mis_summary'],
      includeSummary: true,
      includeDetailed: false,
      includeKeyAccount: false,
    });

    const res = await GET(new Request('http://localhost/api/profile/mis-email'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_access_email_ui).toBe(true);
    expect(body.has_report_access).toBe(true);
    expect(body.scopeLabel).toBe('All branches');
  });

  it('returns 401 when no request user', async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await GET(new Request('http://localhost/api/profile/mis-email'));
    expect(res.status).toBe(401);
  });
});
