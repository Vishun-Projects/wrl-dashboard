import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const listMisEmailRoutingRules = vi.fn();
const createMisEmailRoutingRule = vi.fn();
const updateMisEmailRoutingRule = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/auth/load-user-auth', () => ({
  loadUserAuth: (...args: unknown[]) => loadUserAuth(...args),
}));

vi.mock('@/features/mis-email/lib/routing-rules', async () => {
  const actual = await vi.importActual<typeof import('@/features/mis-email/lib/routing-rules')>(
    '@/features/mis-email/lib/routing-rules'
  );
  return {
    ...actual,
    listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
    createMisEmailRoutingRule: (...args: unknown[]) => createMisEmailRoutingRule(...args),
    updateMisEmailRoutingRule: (...args: unknown[]) => updateMisEmailRoutingRule(...args),
  };
});

describe('mis-email-routing API auth', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    listMisEmailRoutingRules.mockReset();
    createMisEmailRoutingRule.mockReset();
    updateMisEmailRoutingRule.mockReset();
  });

  it('returns 401 when no request user', async () => {
    requireRequestUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/admin/mis-email-routing/route');
    const res = await GET(new Request('http://localhost/api/admin/mis-email-routing'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks HOD routing access', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'branch_manager', office_ids: ['1'] },
      permissions: ['tab_mis_summary'],
    });
    const { GET } = await import('@/app/api/admin/mis-email-routing/route');
    const res = await GET(new Request('http://localhost/api/admin/mis-email-routing'));
    expect(res.status).toBe(403);
  });

  it('returns rules for allowed users', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'hod', office_ids: [] },
      permissions: ['view_all_offices'],
    });
    listMisEmailRoutingRules.mockResolvedValue([{ id: 'r1' }]);
    const { GET } = await import('@/app/api/admin/mis-email-routing/route');
    const res = await GET(new Request('http://localhost/api/admin/mis-email-routing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toEqual([{ id: 'r1' }]);
  });

  it('forwards clientSourceMode on create', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'hod', office_ids: [] },
      permissions: ['view_all_offices'],
    });
    createMisEmailRoutingRule.mockResolvedValue({ id: 'r1', clientSourceMode: 'crm' });

    const { POST } = await import('@/app/api/admin/mis-email-routing/route');
    const res = await POST(
      new Request('http://localhost/api/admin/mis-email-routing', {
        method: 'POST',
        body: JSON.stringify({
          zone: 'NORTH',
          branch: 'Delhi Branch',
          client: 'Acme',
          clientSourceMode: 'crm',
          toEmailsCsv: 'to@example.com',
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(createMisEmailRoutingRule).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSourceMode: 'crm',
      })
    );
  });

  it('forwards clientSourceMode on update', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'hod', office_ids: [] },
      permissions: ['view_all_offices'],
    });
    updateMisEmailRoutingRule.mockResolvedValue({ id: 'r1', clientSourceMode: 'mail' });

    const { PUT } = await import('@/app/api/admin/mis-email-routing/route');
    const res = await PUT(
      new Request('http://localhost/api/admin/mis-email-routing', {
        method: 'PUT',
        body: JSON.stringify({
          id: 'r1',
          clientSourceMode: 'mail',
          toEmailsCsv: 'to@example.com',
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(updateMisEmailRoutingRule).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSourceMode: 'mail',
      })
    );
  });
});
