import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const listMisEmailRoutingOptions = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/auth/load-user-auth', () => ({
  loadUserAuth: (...args: unknown[]) => loadUserAuth(...args),
}));

vi.mock('@/lib/auth/report-security', () => ({
  isHodUser: vi.fn((profile: { role?: string } | undefined, permissions: string[]) => {
    return profile?.role === 'hod' || permissions.includes('view_all_offices');
  }),
}));

vi.mock('@/features/mis-email/services/routing-rules', () => ({
  canManageMisEmailRouting: (user: {
    role?: string;
    permissions?: string[];
    office_ids?: string[];
  }) =>
    user.role === 'hod' ||
    (user.permissions ?? []).includes('view_all_offices') ||
    (user.permissions ?? []).includes('manage_users') ||
    (user.permissions ?? []).includes('manage_roles'),
  normalizeMisEmailRoutingClientSourceMode: (raw: string | null | undefined) =>
    String(raw ?? '')
      .trim()
      .toLowerCase() === 'crm'
      ? 'crm'
      : 'mail',
  listMisEmailRoutingOptions: (...args: unknown[]) => listMisEmailRoutingOptions(...args),
}));

describe('mis-email-routing options API', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    listMisEmailRoutingOptions.mockReset();
  });

  it('returns 401 when no request user', async () => {
    requireRequestUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/admin/mis-email-routing/options/route');
    const req = new NextRequest('http://localhost/api/admin/mis-email-routing/options');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks access', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'branch_manager', office_ids: ['1'], visible_statuses: [] },
      permissions: ['tab_mis_summary'],
    });
    const { GET } = await import('@/app/api/admin/mis-email-routing/options/route');
    const req = new NextRequest('http://localhost/api/admin/mis-email-routing/options');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns scoped options and forwards zone/branch filters', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'branch_manager', office_ids: ['11', '12'], visible_statuses: ['Open Unallocated'] },
      permissions: ['manage_users'],
    });
    listMisEmailRoutingOptions.mockResolvedValue({
      zones: ['NORTH'],
      branches: ['Delhi Branch'],
      clients: ['COKE'],
    });

    const { GET } = await import('@/app/api/admin/mis-email-routing/options/route');
    const req = new NextRequest(
      'http://localhost/api/admin/mis-email-routing/options?zone=NORTH&branch=Delhi%20Branch&clientSourceMode=crm'
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zones).toEqual(['NORTH']);
    expect(body.branches).toEqual(['Delhi Branch']);
    expect(body.clients).toEqual(['COKE']);
    expect(listMisEmailRoutingOptions).toHaveBeenCalledWith({
      zone: 'NORTH',
      branch: 'Delhi Branch',
      clientSourceMode: 'crm',
      assignedOffices: ['11', '12'],
      visibleStatuses: ['Open Unallocated'],
      isHod: false,
    });
  });
});
