import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const listMisEmailRoutingRules = vi.fn();
const createMisEmailRoutingRule = vi.fn();
const updateMisEmailRoutingRule = vi.fn();
const logSecurityEventBestEffort = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/auth/load-user-auth', () => ({
  loadUserAuth: (...args: unknown[]) => loadUserAuth(...args),
}));

vi.mock('@/modules/mis-email/services/routing-rules', () => ({
  canManageMisEmailRouting: (user: {
    role?: string;
    permissions?: string[];
    office_ids?: string[];
  }) =>
    user.role === 'hod' ||
    (user.permissions ?? []).includes('view_all_offices') ||
    (user.permissions ?? []).includes('manage_users') ||
    (user.permissions ?? []).includes('manage_roles'),
  listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
  createMisEmailRoutingRule: (...args: unknown[]) => createMisEmailRoutingRule(...args),
  updateMisEmailRoutingRule: (...args: unknown[]) => updateMisEmailRoutingRule(...args),
  deleteMisEmailRoutingRule: vi.fn(),
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(async () => {}),
  logSecurityEventBestEffort: (...args: unknown[]) => logSecurityEventBestEffort(...args),
  requestAuditContext: () => ({
    route: '/api/admin/mis-email-routing',
    method: 'GET',
    ip: null,
    userAgent: null,
    sessionId: null,
  }),
}));

describe('mis-email-routing API auth', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    listMisEmailRoutingRules.mockReset();
    createMisEmailRoutingRule.mockReset();
    updateMisEmailRoutingRule.mockReset();
    logSecurityEventBestEffort.mockReset();
  });

  it('returns 401 when no request user', async () => {
    requireRequestUser.mockResolvedValue(null);
    const { GET } = await import('@/modules/mis-email/server/routes/routing');
    const res = await GET(new Request('http://localhost/api/admin/mis-email-routing'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks HOD routing access', async () => {
    requireRequestUser.mockResolvedValue({ id: 'u1' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'branch_manager', office_ids: ['1'] },
      permissions: ['tab_mis_summary'],
    });
    const { GET } = await import('@/modules/mis-email/server/routes/routing');
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
    const { GET } = await import('@/modules/mis-email/server/routes/routing');
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

    const { POST } = await import('@/modules/mis-email/server/routes/routing');
    const res = await POST(
      new Request('http://localhost/api/admin/mis-email-routing', {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
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
    requireRequestUser.mockResolvedValue({ id: 'u1', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'hod', office_ids: [] },
      permissions: ['view_all_offices'],
    });
    listMisEmailRoutingRules.mockResolvedValue([
      {
        id: 'r1',
        zone: '',
        branch: '',
        client: '',
        clientSourceMode: 'mail',
        scheduleAnchorTimeIst: '09:30',
        scheduleIntervalMinutes: 1440,
        scheduleDaysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        autoSendEnabled: true,
        toEmails: ['a@example.com'],
        ccEmails: [],
      },
    ]);
    updateMisEmailRoutingRule.mockResolvedValue({
      id: 'r1',
      zone: '',
      branch: '',
      client: '',
      clientSourceMode: 'mail',
      scheduleAnchorTimeIst: '09:30',
      scheduleIntervalMinutes: 1440,
      scheduleDaysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
      autoSendEnabled: true,
      toEmails: ['a@example.com', 'b@example.com'],
      ccEmails: ['c@example.com'],
    });

    const { PUT } = await import('@/modules/mis-email/server/routes/routing');
    const res = await PUT(
      new Request('http://localhost/api/admin/mis-email-routing', {
        method: 'PUT',
        headers: { Origin: 'http://localhost' },
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
    expect(logSecurityEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'admin.mis_email_routing.update',
        metadata: expect.objectContaining({
          summary: 'Updated routing rule · To 1 → 2 · Cc 0 → 1',
          before: expect.objectContaining({ toCount: 1, ccCount: 0 }),
          after: expect.objectContaining({
            toCount: 2,
            ccCount: 1,
            toEmails: ['a@example.com', 'b@example.com'],
          }),
        }),
      })
    );
  });
});
