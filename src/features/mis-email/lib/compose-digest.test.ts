import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMisEmailRoutingRules = vi.fn();
const resolveRoutingClientNamesForScope = vi.fn();
const resolveRoutingScopeForOfficeIds = vi.fn();
const listMatchingMisEmailRoutingRulesForResolvedClients = vi.fn();

vi.mock('@/features/mis-email/lib/routing-rules', () => ({
  listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
  resolveRoutingClientNamesForScope: (...args: unknown[]) =>
    resolveRoutingClientNamesForScope(...args),
  resolveRoutingScopeForOfficeIds: (...args: unknown[]) => resolveRoutingScopeForOfficeIds(...args),
  listMatchingMisEmailRoutingRulesForResolvedClients: (...args: unknown[]) =>
    listMatchingMisEmailRoutingRulesForResolvedClients(...args),
}));

vi.mock('@/features/mis-email/lib/send', () => ({
  resolvePortalUrl: vi.fn(() => 'http://localhost/report'),
  sendPreparedDigestEmail: vi.fn(),
}));

describe('sendMisEmailComposeBatch auto-send override', () => {
  beforeEach(() => {
    listMisEmailRoutingRules.mockReset();
    resolveRoutingClientNamesForScope.mockReset();
    resolveRoutingScopeForOfficeIds.mockReset();
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReset();

    listMisEmailRoutingRules.mockResolvedValue([{ id: 'r1' }]);
    resolveRoutingClientNamesForScope.mockResolvedValue({ mail: [], crm: [] });
    resolveRoutingScopeForOfficeIds.mockResolvedValue({ zones: ['NORTH'], branches: [] });
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReturnValue([
      {
        id: 'r1',
        zone: 'NORTH',
        branch: '',
        client: '',
        toEmails: ['team@example.com'],
        ccEmails: [],
        autoSendEnabled: false,
      },
    ]);
  });

  it(
    'blocks manual send when routing disables auto-send and override is false',
    async () => {
      const mod = await import('@/features/mis-email/lib/compose-digest');

      await expect(
        mod.sendMisEmailComposeBatch(
          {
            id: 'u1',
            name: 'User',
            email: 'user@example.com',
            role: 'branch_manager',
            office_ids: ['1'],
            permissions: [],
            mis_email_preferences: {},
          } as never,
          {
            sendTo: ['manual@example.com'],
            allowAutoSendDisabledOverride: false,
          }
        )
      ).rejects.toThrow(/Auto-send disabled/);
    },
    15_000
  );

  it('allows override path to proceed past auto-send block', async () => {
    const mod = await import('@/features/mis-email/lib/compose-digest');
    // view_all_offices avoids a live DB lookup for branch scope labels in this unit test.
    await expect(
      mod.sendMisEmailComposeBatch(
        {
          id: 'u1',
          name: 'User',
          email: 'user@example.com',
          role: 'branch_manager',
          office_ids: ['1'],
          permissions: ['view_all_offices'],
          includeSummary: false,
          includeDetailed: false,
          includeKeyAccount: false,
          mis_email_preferences: {
            includeSummary: false,
            includeDetailed: false,
            includeKeyAccount: false,
            includeTraceableExport: false,
            includeOpenCallsExport: false,
            bodySections: [],
          },
        } as never,
        {
          sendTo: ['manual@example.com'],
          allowAutoSendDisabledOverride: true,
        }
      )
    ).rejects.toThrow(/Select at least one report attachment/);
  });
});
