import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const updateUserById = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/auth/load-user-auth', () => ({
  loadUserAuth: (...args: unknown[]) => loadUserAuth(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => updateUserById(...args),
      },
    },
  }),
}));

vi.mock('@/lib/auth/verify-jwt', () => ({
  isDevAuthBypass: () => false,
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(),
  logAction: vi.fn(),
  requestAuditContext: () => ({
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    sessionId: 'test-session',
    route: '/api/admin/users/password',
    method: 'POST',
  }),
}));

describe('Admin Password Reset Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects password reset on super_admin by a non-super-admin with 403', async () => {
    // Non-super-admin caller
    requireRequestUser.mockResolvedValueOnce({ id: 'caller-admin', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValueOnce({
      profile: { email: 'admin@example.com', role: 'admin' },
      permissions: ['manage_users'],
    });

    // Target user is a super admin
    loadUserAuth.mockResolvedValueOnce({
      profile: { email: 'super@example.com', role: 'super_admin' },
      permissions: ['manage_users', 'super_admin'],
    });

    const { POST } = await import('./password');
    const res = await POST(
      new Request('http://localhost/api/admin/users/password', {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ userId: 'target-super-admin', newPassword: 'NewPassword123!' }),
      })
    );

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Only super administrators can reset passwords for super admin accounts');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('allows password reset on standard user by non-super-admin', async () => {
    // Non-super-admin caller with manage_users
    requireRequestUser.mockResolvedValueOnce({ id: 'caller-admin', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValueOnce({
      profile: { email: 'admin@example.com', role: 'admin' },
      permissions: ['manage_users'],
    });

    // Target user is a standard user
    loadUserAuth.mockResolvedValueOnce({
      profile: { email: 'user@example.com', role: 'viewer' },
      permissions: ['page_mis_reports'],
    });

    updateUserById.mockResolvedValueOnce({ error: null });

    const { POST } = await import('./password');
    const res = await POST(
      new Request('http://localhost/api/admin/users/password', {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ userId: 'target-user', newPassword: 'NewPassword123!' }),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith('target-user', { password: 'NewPassword123!' });
  });
});
