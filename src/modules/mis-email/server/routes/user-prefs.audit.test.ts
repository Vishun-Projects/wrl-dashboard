import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const adminUpdateMisEmailUserPrefs = vi.fn();
const getMisEmailOrgSettings = vi.fn();
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
  canManageMisEmailRouting: () => true,
}));

vi.mock('@/modules/mis-email/services/org-settings', () => ({
  getMisEmailOrgSettings: (...args: unknown[]) => getMisEmailOrgSettings(...args),
}));

vi.mock('@/modules/mis-email/services/list-user-schedules', () => ({
  adminUpdateMisEmailUserPrefs: (...args: unknown[]) => adminUpdateMisEmailUserPrefs(...args),
  listMisEmailUserSchedules: vi.fn(),
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(async () => {}),
  logSecurityEventBestEffort: (...args: unknown[]) => logSecurityEventBestEffort(...args),
  requestAuditContext: () => ({
    route: '/api/admin/mis-email-user-prefs',
    method: 'PATCH',
    ip: null,
    userAgent: null,
    sessionId: null,
  }),
}));

describe('admin mis email user prefs audit metadata', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    adminUpdateMisEmailUserPrefs.mockReset();
    getMisEmailOrgSettings.mockReset();
    logSecurityEventBestEffort.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'admin1', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'hod', office_ids: [] },
      permissions: ['view_all_offices'],
    });
    getMisEmailOrgSettings.mockResolvedValue({ allowedEmailDomains: ['example.com'] });
  });

  it('logs before/after changes on prefs update', async () => {
    adminUpdateMisEmailUserPrefs.mockResolvedValue({
      before: {
        id: 'u1',
        name: 'Vishnu',
        email: 'vishnu@example.com',
        misEmailEnabled: true,
        subscribed: true,
        sendTimeIst: '09:30',
        dateRange: 'year_to_yesterday',
        toEmails: ['a@example.com'],
        ccEmails: [],
      },
      user: {
        id: 'u1',
        name: 'Vishnu',
        email: 'vishnu@example.com',
        misEmailEnabled: true,
        subscribed: true,
        sendTimeIst: '12:45',
        dateRange: 'year_to_yesterday',
        toEmails: ['a@example.com'],
        ccEmails: [],
      },
    });

    const { PATCH } = await import('@/modules/mis-email/server/routes/user-prefs');
    const res = await PATCH(
      new Request('http://localhost/api/admin/mis-email-user-prefs', {
        method: 'PATCH',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ userId: 'u1', patch: { sendTimeIst: '12:45' } }),
      })
    );

    expect(res.status).toBe(200);
    expect(logSecurityEventBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'admin.mis_email_user_prefs.update',
        metadata: expect.objectContaining({
          summary: 'Updated personal MIS digest prefs for vishnu@example.com',
          actionLabel: 'Updated personal MIS digest prefs',
          changes: expect.objectContaining({
            sendTimeIst: { old: '09:30', new: '12:45' },
          }),
        }),
      })
    );
  });
});
