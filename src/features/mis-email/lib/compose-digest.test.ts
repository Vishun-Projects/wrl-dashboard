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

vi.mock('@/features/mis-email/lib/user-scope', () => ({
  resolveUserDigestScope: vi.fn((recipient: { permissions?: string[]; office_ids?: string[] }) => ({
    isHod: (recipient.permissions ?? []).includes('view_all_offices'),
    assignedOffices: (recipient.office_ids ?? []).map(String),
    seesAll: (recipient.permissions ?? []).includes('view_all_offices'),
  })),
  resolveUserDigestScopeWithLabel: vi.fn(async () => ({
    isHod: true,
    assignedOffices: ['1'],
    scopeLabel: 'All branches',
  })),
}));

// Static import after mocks — avoids cold dynamic-import eating the test timeout.
const { sendMisEmailComposeBatch } = await import('@/features/mis-email/lib/compose-digest');

const recipient = {
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
} as never;

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

  it('blocks manual send when routing disables auto-send and override is false', async () => {
    await expect(
      sendMisEmailComposeBatch(recipient, {
        sendTo: ['manual@example.com'],
        allowAutoSendDisabledOverride: false,
      })
    ).rejects.toThrow(/Auto-send disabled/);
  });

  it('allows override path to proceed past auto-send block', async () => {
    await expect(
      sendMisEmailComposeBatch(recipient, {
        sendTo: ['manual@example.com'],
        allowAutoSendDisabledOverride: true,
      })
    ).rejects.toThrow(/Select at least one report attachment/);
  });
});
