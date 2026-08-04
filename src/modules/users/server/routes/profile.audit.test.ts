import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const queryRawUnsafe = vi.fn();
const logAction = vi.fn();

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
  logAction: (...args: unknown[]) => logAction(...args),
}));

describe('profile update audit metadata', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    queryRawUnsafe.mockReset();
    logAction.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'u1', email: 'me@example.com' });
    loadUserAuth.mockResolvedValue({
      profile: { email: 'me@example.com', name: 'Me' },
      permissions: [],
    });
  });

  it('logs old/new changes for profile fields', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([{ name: 'Old Name', avatar_url: null, theme: 'light' }])
      .mockResolvedValueOnce(undefined);

    const { PATCH } = await import('@/modules/users/server/routes/profile');
    const res = await PATCH(
      new Request('http://localhost/api/profile', {
        method: 'PATCH',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ name: 'New Name', theme: 'dark' }),
      })
    );

    expect(res.status).toBe(200);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'profile.update',
        metadata: expect.objectContaining({
          changed: expect.arrayContaining(['name', 'theme']),
          changes: {
            name: { old: 'Old Name', new: 'New Name' },
            theme: { old: 'light', new: 'dark' },
          },
        }),
      })
    );
  });
});
