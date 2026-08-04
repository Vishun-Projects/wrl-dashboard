import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const loadUserAuth = vi.fn();
const getMajorRepairRepeatRecipient = vi.fn();
const updateMajorRepairRepeatRecipient = vi.fn();
const deleteMajorRepairRepeatRecipient = vi.fn();
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

vi.mock('@/lib/auth/rbac-catalog', () => ({
  canAccessPage: () => true,
}));

vi.mock('@/modules/mis-email/server/sync/major-repair-repeat-recipients', () => ({
  createMajorRepairRepeatRecipient: vi.fn(),
  deleteMajorRepairRepeatRecipient: (...args: unknown[]) => deleteMajorRepairRepeatRecipient(...args),
  getMajorRepairRepeatRecipient: (...args: unknown[]) => getMajorRepairRepeatRecipient(...args),
  listBranchOptionsForRecipients: vi.fn(),
  listMajorRepairRepeatRecipients: vi.fn(),
  updateMajorRepairRepeatRecipient: (...args: unknown[]) => updateMajorRepairRepeatRecipient(...args),
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(async () => {}),
  logAction: (...args: unknown[]) => logAction(...args),
}));

describe('major repair recipients audit metadata', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    loadUserAuth.mockReset();
    getMajorRepairRepeatRecipient.mockReset();
    updateMajorRepairRepeatRecipient.mockReset();
    deleteMajorRepairRepeatRecipient.mockReset();
    logAction.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'admin1', email: 'admin@example.com' });
    loadUserAuth.mockResolvedValue({
      profile: { role: 'admin', email: 'admin@example.com', name: 'Admin', office_ids: [] },
      permissions: ['page_major_repair_alerts'],
    });
  });

  it('logs before/after on recipient update', async () => {
    getMajorRepairRepeatRecipient.mockResolvedValue({
      id: 'r1',
      branch: 'Mumbai',
      recipientName: 'Old',
      email: 'old@example.com',
      enabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    updateMajorRepairRepeatRecipient.mockResolvedValue({
      id: 'r1',
      branch: 'Mumbai',
      recipientName: 'New',
      email: 'new@example.com',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    });

    const { PUT } = await import('@/modules/mis-email/server/routes/major-repair-recipients');
    const res = await PUT(
      new Request('http://localhost/api/admin/major-repair-recipients', {
        method: 'PUT',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({
          id: 'r1',
          branch: 'Mumbai',
          recipientName: 'New',
          email: 'new@example.com',
          enabled: true,
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.major_repair_recipient.update',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ email: 'old@example.com', enabled: false }),
          after: expect.objectContaining({ email: 'new@example.com', enabled: true }),
          changes: expect.objectContaining({
            email: { old: 'old@example.com', new: 'new@example.com' },
          }),
        }),
      })
    );
  });

  it('logs before snapshot on recipient delete', async () => {
    getMajorRepairRepeatRecipient.mockResolvedValue({
      id: 'r1',
      branch: 'Delhi',
      recipientName: 'Sam',
      email: 'sam@example.com',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    deleteMajorRepairRepeatRecipient.mockResolvedValue(undefined);

    const { DELETE } = await import('@/modules/mis-email/server/routes/major-repair-recipients');
    const res = await DELETE(
      new Request('http://localhost/api/admin/major-repair-recipients?id=r1', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost' },
      })
    );

    expect(res.status).toBe(200);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.major_repair_recipient.delete',
        summary: 'Deleted major-repair recipient sam@example.com (Delhi)',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ email: 'sam@example.com', branch: 'Delhi' }),
        }),
      })
    );
  });
});
