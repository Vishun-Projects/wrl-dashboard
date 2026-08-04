import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/mis-email/services/org-settings', () => ({
  assertOrgOutboundMailEnabled: vi.fn(),
  getMisEmailOrgSettings: vi.fn(async () => ({
    outboundMailEnabled: false,
    portalBaseUrl: 'https://example.test',
    greeting: 'Dear Zonal Heads,',
    brandTitle: 'WESTERN REFRIGERATION',
    brandSubtitle: 'WRL Dashboard',
    subjectTemplate: 'Daily MIS Report as on {asOn}',
  })),
  OutboundMailDisabledError: class OutboundMailDisabledError extends Error {
    constructor(message?: string) {
      super(message ?? 'Outbound mail is disabled');
      this.name = 'OutboundMailDisabledError';
    }
  },
}));

vi.mock('@/modules/mis-email/services/send-relay', () => ({
  isMisEmailRelayConfigured: vi.fn(() => false),
  sendPreparedMisEmailViaVpsRelay: vi.fn(),
}));

vi.mock('@/lib/mail/smtp', () => ({
  resolvePortalUrl: vi.fn((u?: string) => u || 'https://wrl-dashboard.vercel.app'),
  resolveSmtpConfig: vi.fn(() => ({
    host: 'localhost',
    port: 25,
    secure: false,
    from: 'noreply@test',
  })),
  createMailTransport: vi.fn(() => ({
    sendMail: vi.fn(async () => ({ messageId: 'smtp-1' })),
  })),
  isSmtpConfigured: vi.fn(() => true),
}));

import { assertOrgOutboundMailEnabled } from '@/modules/mis-email/services/org-settings';
import { sendPreparedDigestEmail } from '@/modules/mis-email/services/send';
import { createMailTransport } from '@/lib/mail/smtp';

describe('sendPreparedDigestEmail outbound gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MIS_EMAIL_DRY_RUN;
  });

  it('does not call SMTP when org outbound is disabled', async () => {
    vi.mocked(assertOrgOutboundMailEnabled).mockRejectedValueOnce(
      new Error('Outbound mail is disabled by organization settings. Ask an admin/HOD to enable it.')
    );

    await expect(
      sendPreparedDigestEmail({
        to: 'mis.service@westernequipments.com',
        subject: 'x',
        html: '<p>x</p>',
        text: 'x',
        attachments: [],
      })
    ).rejects.toThrow(/Outbound mail is disabled/);

    expect(createMailTransport).not.toHaveBeenCalled();
  });

  it('sends when outbound gate passes', async () => {
    vi.mocked(assertOrgOutboundMailEnabled).mockResolvedValueOnce(undefined);
    const sendMail = vi.fn(async () => ({ messageId: 'ok' }));
    vi.mocked(createMailTransport).mockReturnValueOnce({ sendMail } as never);

    const result = await sendPreparedDigestEmail({
      to: 'mis.service@westernequipments.com',
      subject: 'x',
      html: '<p>x</p>',
      text: 'x',
      attachments: [],
    });
    expect(result.messageId).toBe('ok');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
