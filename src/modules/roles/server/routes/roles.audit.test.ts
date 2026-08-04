import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const queryRawUnsafe = vi.fn();
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

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
  },
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(async () => {}),
  logSecurityEventBestEffort: (...args: unknown[]) => logSecurityEventBestEffort(...args),
  requestAuditContext: () => ({
    route: '/api/admin/roles',
    method: 'DELETE',
    ip: null,
    userAgent: null,
    sessionId: null,
  }),
}));

describe('admin roles audit metadata', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    queryRawUnsafe.mockReset();
    logSecurityEventBestEffort.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'admin1', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'admin' },
      permissions: ['manage_roles'],
    });
  });

  it('logs before snapshot on role delete', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([{ name: 'Branch Manager', description: 'ops' }])
      .mockResolvedValueOnce([{ permission_id: 'p1' }, { permission_id: 'p2' }])
      .mockResolvedValueOnce(undefined);

    const { DELETE } = await import('@/modules/roles/server/routes/roles');
    const res = await DELETE(
      new Request('http://localhost/api/admin/roles?id=role-1', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost' },
      })
    );

    expect(res.status).toBe(200);
    expect(logSecurityEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'admin.role.delete',
        targetLabel: 'Branch Manager',
        metadata: expect.objectContaining({
          summary: 'Deleted role Branch Manager',
          actionLabel: 'Deleted role',
          before: {
            name: 'Branch Manager',
            description: 'ops',
            permissionIds: ['p1', 'p2'],
          },
        }),
      })
    );
  });

  it('logs after snapshot on role create', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([{ id: 'role-new' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const { POST } = await import('@/modules/roles/server/routes/roles');
    const res = await POST(
      new Request('http://localhost/api/admin/roles', {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({
          name: 'Viewer',
          description: 'read only',
          permissionIds: ['perm-a', 'perm-b'],
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(logSecurityEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'admin.role.create',
        metadata: expect.objectContaining({
          summary: 'Created role Viewer',
          actionLabel: 'Created role',
          after: {
            name: 'Viewer',
            description: 'read only',
            permissionIds: ['perm-a', 'perm-b'],
          },
        }),
      })
    );
  });
});
