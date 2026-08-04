import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const queryRawUnsafe = vi.fn();
const logSecurityEventBestEffort = vi.fn();
const deleteUser = vi.fn();

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

vi.mock('@/lib/auth/db-create-user', () => ({
  createAuthUserViaDatabase: vi.fn(),
  deleteAuthUserViaDatabase: vi.fn(),
  findAuthUserIdByEmail: vi.fn(),
}));

vi.mock('@/lib/auth/db-sign-in', () => ({
  isDbSignInAvailable: () => false,
}));

vi.mock('@/lib/auth/verify-jwt', () => ({
  isDevAuthBypass: () => false,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser: (...args: unknown[]) => deleteUser(...args),
        createUser: vi.fn(),
      },
    },
  },
}));

vi.mock('@/modules/mis-email', () => ({
  defaultPreferencesForRecipient: vi.fn(),
}));

vi.mock('@/lib/auth/user-roles', () => ({
  loadPermissionsForRoleIds: vi.fn(async () => []),
  loadRoleNamesByIds: vi.fn(async () => ({})),
  normalizeRoleIds: (ids: string[]) => ids,
  replaceUserRoles: vi.fn(),
}));

vi.mock('@/lib/auth/admin-bootstrap-cache', () => ({
  clearAdminBootstrapCache: vi.fn(),
}));

vi.mock('@/lib/auth/me-cache', () => ({
  clearMeCache: vi.fn(),
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(async () => {}),
  logSecurityEventBestEffort: (...args: unknown[]) => logSecurityEventBestEffort(...args),
  requestAuditContext: () => ({
    route: '/api/admin/users',
    method: 'DELETE',
    ip: null,
    userAgent: null,
    sessionId: null,
  }),
}));

describe('admin users audit metadata', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    queryRawUnsafe.mockReset();
    logSecurityEventBestEffort.mockReset();
    deleteUser.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'admin1', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'admin' },
      permissions: ['manage_users'],
    });
    deleteUser.mockResolvedValue({ data: {}, error: null });
  });

  it('logs before snapshot on user delete', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([
        {
          name: 'Samiran M',
          email: 'samiran.m@example.com',
          role: 'hod',
          role_id: 'r1',
          office_ids: ['1'],
          visible_statuses: ['OPEN'],
          mis_email_enabled: true,
          role_ids: ['r1', 'r2'],
        },
      ])
      .mockResolvedValueOnce(undefined);

    const { DELETE } = await import('@/modules/users/server/routes/users');
    const res = await DELETE(
      new Request('http://localhost/api/admin/users?id=user-2', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost' },
      })
    );

    expect(res.status).toBe(200);
    expect(logSecurityEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'admin.user.delete',
        targetLabel: 'samiran.m@example.com',
        metadata: expect.objectContaining({
          summary: 'Deleted user samiran.m@example.com',
          actionLabel: 'Deleted user',
          before: expect.objectContaining({
            email: 'samiran.m@example.com',
            name: 'Samiran M',
            roleIds: ['r1', 'r2'],
            misEmailEnabled: true,
          }),
        }),
      })
    );
  });
});
