import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const queryRawUnsafe = vi.fn();
const loadDigestRecipientById = vi.fn();
const previewMisEmailCompose = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/server-user', () => ({
  requireRequestUser: (...args: unknown[]) => requireRequestUser(...args),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
  },
}));

vi.mock('@/features/mis-email/services/recipients', () => ({
  loadDigestRecipientById: (...args: unknown[]) => loadDigestRecipientById(...args),
}));

vi.mock('@/features/mis-email/services/compose-digest', () => ({
  previewMisEmailCompose: (...args: unknown[]) => previewMisEmailCompose(...args),
}));

const { POST } = await import('@/app/api/profile/mis-email/preview/route');

function mailOnlyRecipient() {
  return {
    id: 'u1',
    name: 'User',
    email: 'user@example.com',
    permissions: ['mis_email_send'],
    includeSummary: false,
    includeDetailed: false,
    includeKeyAccount: false,
  };
}

function mailWithSummaryRecipient() {
  return {
    ...mailOnlyRecipient(),
    permissions: ['mis_email_send', 'tab_mis_summary'],
    includeSummary: true,
  };
}

describe('POST /api/profile/mis-email/preview gates', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    queryRawUnsafe.mockReset();
    loadDigestRecipientById.mockReset();
    previewMisEmailCompose.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'u1', email: 'user@example.com' });
    queryRawUnsafe.mockResolvedValue([
      { mis_email_enabled: false, mis_email_preferences: {} },
    ]);
  });

  it('returns 403 when role lacks mis_email_send', async () => {
    loadDigestRecipientById.mockResolvedValue({
      ...mailWithSummaryRecipient(),
      permissions: ['tab_mis_summary'],
    });

    const res = await POST(
      new Request('http://localhost/api/profile/mis-email/preview', {
        method: 'POST',
        body: JSON.stringify({ preferences: {} }),
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/MIS email reports/i);
    expect(previewMisEmailCompose).not.toHaveBeenCalled();
  });

  it('returns 403 when mail access but no report tabs', async () => {
    loadDigestRecipientById.mockResolvedValue(mailOnlyRecipient());

    const res = await POST(
      new Request('http://localhost/api/profile/mis-email/preview', {
        method: 'POST',
        body: JSON.stringify({ preferences: {} }),
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Mail access alone is not enough/i);
    expect(previewMisEmailCompose).not.toHaveBeenCalled();
  });

  it('returns preview when mail + summary access', async () => {
    loadDigestRecipientById.mockResolvedValue(mailWithSummaryRecipient());
    previewMisEmailCompose.mockResolvedValue({
      subject: 'Daily MIS Report as on 27-07-2026',
      attachments: ['Summary.xlsx'],
      html: '<html></html>',
    });

    const res = await POST(
      new Request('http://localhost/api/profile/mis-email/preview', {
        method: 'POST',
        body: JSON.stringify({ preferences: { includeSummary: true } }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.preview.subject).toMatch(/Daily MIS Report/);
    expect(previewMisEmailCompose).toHaveBeenCalled();
  });
});
