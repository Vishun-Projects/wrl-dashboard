import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMisEmailRoutingForRecipient = vi.fn();

vi.mock('@/lib/mis-email/routing-rules', () => ({
  resolveMisEmailRoutingForRecipient: (...args: unknown[]) => resolveMisEmailRoutingForRecipient(...args),
}));

vi.mock('@/lib/mis-email/send', () => ({
  resolvePortalUrl: vi.fn(() => 'http://localhost/report'),
  sendPreparedDigestEmail: vi.fn(),
}));

describe('sendMisEmailComposeBatch auto-send override', () => {
  beforeEach(() => {
    resolveMisEmailRoutingForRecipient.mockReset();
  });

  it('blocks manual send when routing disables auto-send and override is false', async () => {
    const mod = await import('@/lib/mis-email/compose-digest');
    resolveMisEmailRoutingForRecipient.mockResolvedValue({
      matchedRule: { id: 'r1' },
      to: ['team@example.com'],
      cc: [],
      autoSendEnabled: false,
    });

    await expect(
      mod.sendMisEmailComposeBatch(
        {
          id: 'u1',
          name: 'User',
          email: 'user@example.com',
          office_ids: ['1'],
          mis_email_preferences: {},
        } as never,
        {
          sendTo: ['manual@example.com'],
          allowAutoSendDisabledOverride: false,
        }
      )
    ).rejects.toThrow(/Auto-send disabled/);
  });

  it('allows override path to proceed past auto-send block', async () => {
    const mod = await import('@/lib/mis-email/compose-digest');
    resolveMisEmailRoutingForRecipient.mockResolvedValue({
      matchedRule: { id: 'r1' },
      to: ['team@example.com'],
      cc: [],
      autoSendEnabled: false,
    });
    await expect(
      mod.sendMisEmailComposeBatch(
        {
          id: 'u1',
          name: 'User',
          email: 'user@example.com',
          office_ids: ['1'],
          includeSummary: false,
          includeDetailed: false,
          includeKeyAccount: false,
          mis_email_preferences: {},
        } as never,
        {
          sendTo: ['manual@example.com'],
          allowAutoSendDisabledOverride: true,
        }
      )
    ).rejects.toThrow(/Select at least one report attachment/);
  });
});
