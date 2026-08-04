import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: vi.fn(),
}));
vi.mock('@/lib/auth/load-user-auth', () => ({
  loadUserAuth: vi.fn(),
}));
vi.mock('@/modules/mis-email/services/routing-rules', () => ({
  canManageMisEmailRouting: vi.fn(),
}));
vi.mock('@/modules/mis-email/services/org-settings', () => ({
  getMisEmailOrgSettings: vi.fn(),
  saveMisEmailOrgSettings: vi.fn(),
}));

import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canManageMisEmailRouting } from '@/modules/mis-email/services/routing-rules';
import {
  getMisEmailOrgSettings,
  saveMisEmailOrgSettings,
} from '@/modules/mis-email/services/org-settings';
import { GET, PUT } from '@/app/api/admin/mis-email-org-settings/route';
import { MIS_EMAIL_ORG_SETTINGS_FALLBACKS } from '@/modules/mis-email/services/org-settings-defaults';

const requireRequestUserMock = vi.mocked(requireRequestUser);
const loadUserAuthMock = vi.mocked(loadUserAuth);
const canManageMock = vi.mocked(canManageMisEmailRouting);
const getSettingsMock = vi.mocked(getMisEmailOrgSettings);
const saveSettingsMock = vi.mocked(saveMisEmailOrgSettings);

describe('/api/admin/mis-email-org-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockResolvedValue({ ...MIS_EMAIL_ORG_SETTINGS_FALLBACKS });
    saveSettingsMock.mockImplementation(async (patch) => ({
      ...MIS_EMAIL_ORG_SETTINGS_FALLBACKS,
      ...patch,
    }));
  });

  it('GET 401 when unauthenticated', async () => {
    requireRequestUserMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/admin/mis-email-org-settings'));
    expect(res.status).toBe(401);
  });

  it('GET 403 without routing capability', async () => {
    requireRequestUserMock.mockResolvedValue({ id: 'u1' } as never);
    loadUserAuthMock.mockResolvedValue({
      profile: { role: 'user', office_ids: [] },
      permissions: [],
    } as never);
    canManageMock.mockReturnValue(false);
    const res = await GET(new NextRequest('http://localhost/api/admin/mis-email-org-settings'));
    expect(res.status).toBe(403);
  });

  it('GET returns settings', async () => {
    requireRequestUserMock.mockResolvedValue({ id: 'u1' } as never);
    loadUserAuthMock.mockResolvedValue({
      profile: { role: 'admin', office_ids: [] },
      permissions: ['manage_users'],
    } as never);
    canManageMock.mockReturnValue(true);
    const res = await GET(new NextRequest('http://localhost/api/admin/mis-email-org-settings'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.digestCallType).toBe('BREAKDOWN');
  });

  it('PUT saves without calling SMTP and rejects bad domains', async () => {
    requireRequestUserMock.mockResolvedValue({ id: 'u1' } as never);
    loadUserAuthMock.mockResolvedValue({
      profile: { role: 'admin', office_ids: [] },
      permissions: ['manage_users'],
    } as never);
    canManageMock.mockReturnValue(true);

    const putHeaders = {
      'content-type': 'application/json',
      origin: 'http://localhost',
    };

    const bad = await PUT(
      new NextRequest('http://localhost/api/admin/mis-email-org-settings', {
        method: 'PUT',
        headers: putHeaders,
        body: JSON.stringify({
          settings: { defaultToEmails: ['someone@gmail.com'] },
        }),
      })
    );
    expect(bad.status).toBe(400);
    expect(saveSettingsMock).not.toHaveBeenCalled();

    const ok = await PUT(
      new NextRequest('http://localhost/api/admin/mis-email-org-settings', {
        method: 'PUT',
        headers: putHeaders,
        body: JSON.stringify({
          settings: {
            defaultToEmails: ['mis.service@westernequipments.com'],
            outboundMailEnabled: false,
          },
        }),
      })
    );
    expect(ok.status).toBe(200);
    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(saveSettingsMock.mock.calls[0][1]).toBe('u1');
  });
});
