import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestUser = vi.fn();
const queryRawUnsafe = vi.fn();
const loadDigestRecipientById = vi.fn();
const createMisEmailSendJob = vi.fn();
const afterFn = vi.fn();

vi.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    private body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
    async json() {
      return this.body;
    }
  }
  return {
    NextResponse: MockNextResponse,
    after: (...args: unknown[]) => afterFn(...args),
  };
});

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

vi.mock('@/features/mis-email/lib/recipients', () => ({
  loadDigestRecipientById: (...args: unknown[]) => loadDigestRecipientById(...args),
}));

vi.mock('@/features/mis-email/lib/send-jobs', () => ({
  createMisEmailSendJob: (...args: unknown[]) => createMisEmailSendJob(...args),
  updateMisEmailSendJob: vi.fn(),
}));

vi.mock('@/features/mis-email/lib/compose-digest', () => ({
  sendMisEmailComposeBatch: vi.fn(),
}));

vi.mock('@/features/mis-email/lib/org-settings', () => ({
  getMisEmailOrgSettings: vi.fn(async () => ({
    allowedEmailDomains: ['westernequipments.com'],
    outboundMailEnabled: true,
  })),
}));

vi.mock('@/lib/security/audit', () => ({
  logAccessDenied: vi.fn(async () => {}),
  logAction: vi.fn(async () => {}),
}));

vi.mock('@/lib/auth/user-auth-query', () => ({
  queryUserAuth: vi.fn(async () => ({
    profile: { email: 'user@example.com', name: 'User' },
    permissions: [],
  })),
}));

const { POST } = await import('@/app/api/profile/mis-email/send/route');

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

describe('POST /api/profile/mis-email/send gates', () => {
  beforeEach(() => {
    requireRequestUser.mockReset();
    queryRawUnsafe.mockReset();
    loadDigestRecipientById.mockReset();
    createMisEmailSendJob.mockReset();
    afterFn.mockReset();
    requireRequestUser.mockResolvedValue({ id: 'u1', email: 'user@example.com' });
    queryRawUnsafe.mockResolvedValue([
      {
        mis_email_enabled: false,
        mis_email_preferences: {
          includeSummary: true,
          includeDetailed: false,
          includeKeyAccount: false,
        },
      },
    ]);
  });

  it('returns 403 when role lacks mis_email_send', async () => {
    loadDigestRecipientById.mockResolvedValue({
      ...mailWithSummaryRecipient(),
      permissions: ['tab_mis_summary'],
    });

    const res = await POST(
      new Request('http://localhost/api/profile/mis-email/send', {
        method: 'POST',
        body: JSON.stringify({ preferences: { includeSummary: true } }),
      })
    );
    expect(res.status).toBe(403);
    expect(createMisEmailSendJob).not.toHaveBeenCalled();
  });

  it('returns 403 when mail access but no report tabs', async () => {
    loadDigestRecipientById.mockResolvedValue(mailOnlyRecipient());

    const res = await POST(
      new Request('http://localhost/api/profile/mis-email/send', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Mail access alone is not enough/i);
    expect(createMisEmailSendJob).not.toHaveBeenCalled();
  });

  it('queues send with 202 jobId when mail + summary access', async () => {
    loadDigestRecipientById.mockResolvedValue(mailWithSummaryRecipient());
    createMisEmailSendJob.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      message: 'Queued',
    });

    const res = await POST(
      new Request('http://localhost/api/profile/mis-email/send', {
        method: 'POST',
        body: JSON.stringify({ preferences: { includeSummary: true } }),
      })
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe('job-1');
    expect(createMisEmailSendJob).toHaveBeenCalledWith('u1');
    expect(afterFn).toHaveBeenCalledOnce();
  });
});
