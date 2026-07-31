import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMisEmailRoutingRules = vi.fn();
const resolveRoutingClientNamesForScope = vi.fn();
const resolveRoutingScopeForOfficeIds = vi.fn();
const listMatchingMisEmailRoutingRulesForResolvedClients = vi.fn();
const fetchDigestSummaryDataCached = vi.fn();
const fetchDigestClientAccountSummaryCached = vi.fn();
const fetchDigestRegisterRows = vi.fn();
const buildDigestAttachments = vi.fn();
const buildDigestTraceableExportPayload = vi.fn();

vi.mock('@/features/mis-email/services/routing-rules', () => ({
  listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
  resolveRoutingClientNamesForScope: (...args: unknown[]) =>
    resolveRoutingClientNamesForScope(...args),
  resolveRoutingScopeForOfficeIds: (...args: unknown[]) => resolveRoutingScopeForOfficeIds(...args),
  listMatchingMisEmailRoutingRulesForResolvedClients: (...args: unknown[]) =>
    listMatchingMisEmailRoutingRulesForResolvedClients(...args),
}));

vi.mock('@/features/mis-email/services/send', () => ({
  resolvePortalUrl: vi.fn((u?: string) => u || 'http://localhost/report'),
  sendPreparedDigestEmail: vi.fn(),
}));

vi.mock('@/features/mis-email/services/org-settings', () => ({
  getMisEmailOrgSettings: vi.fn(async () => ({
    portalBaseUrl: 'http://localhost',
    greeting: 'Dear Zonal Heads,',
    brandTitle: 'WESTERN REFRIGERATION',
    brandSubtitle: 'WRL Dashboard',
    subjectTemplate: 'Daily MIS Report as on {asOn}',
    subjectTemplateRevised: 'Daily MIS Report as on {asOn} (Revised)',
    digestCallType: 'BREAKDOWN',
    allowedEmailDomains: ['westernequipments.com'],
    outboundMailEnabled: true,
    defaultToEmails: [],
    defaultCcEmails: [],
    defaultSendTimeIst: '09:30',
    defaultDateRange: 'month_to_date',
    majorRepairMinCount: 3,
    majorRepairMonths: 3,
    majorRepairDefaultTo: 'sunil.sawant@westernequipments.com',
    majorRepairDefaultCc: 'vishnu.vishwakarma@westernequipments.com',
  })),
  assertOrgOutboundMailEnabled: vi.fn(),
}));

vi.mock('@/features/mis-email/services/user-scope', () => ({
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

vi.mock('@/features/mis-email/services/digest-cache', () => ({
  fetchDigestSummaryDataCached: (...args: unknown[]) => fetchDigestSummaryDataCached(...args),
  fetchDigestClientAccountSummaryCached: (...args: unknown[]) =>
    fetchDigestClientAccountSummaryCached(...args),
}));

vi.mock('@/features/mis-email/services/fetch-digest-data', () => ({
  fetchDigestRegisterRows: (...args: unknown[]) => fetchDigestRegisterRows(...args),
}));

vi.mock('@/features/mis-email/services/build-attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/mis-email/services/build-attachments')>();
  return {
    ...actual,
    buildDigestAttachments: (...args: unknown[]) => buildDigestAttachments(...args),
  };
});

vi.mock('@/features/mis-email/services/fetch-digest-trace', () => ({
  buildDigestTraceableExportPayload: (...args: unknown[]) =>
    buildDigestTraceableExportPayload(...args),
}));

// Static import after mocks — avoids cold dynamic-import eating the test timeout.
const {
  buildMisEmailPayload,
  resolveMisEmailSendTargets,
  sendMisEmailComposeBatch,
} = await import('@/features/mis-email/services/compose-digest');

const emptyRecipient = {
  id: 'u1',
  name: 'User',
  email: 'user@example.com',
  role: 'branch_manager',
  office_ids: ['1'],
  visible_statuses: [],
  permissions: ['view_all_offices'],
  includeSummary: false,
  includeDetailed: false,
  includeKeyAccount: false,
  mis_email_enabled: true,
  mis_email_preferences: {
    includeSummary: false,
    includeDetailed: false,
    includeKeyAccount: false,
    includeTraceableExport: false,
    includeOpenCallsExport: false,
    bodyInEmail: [],
  },
} as const;

const summaryRecipient = {
  ...emptyRecipient,
  includeSummary: true,
  includeDetailed: true,
  mis_email_preferences: {
    includeSummary: true,
    includeDetailed: true,
    includeKeyAccount: false,
    includeTraceableExport: false,
    includeOpenCallsExport: false,
    bodyInEmail: [],
  },
} as const;

describe('sendMisEmailComposeBatch auto-send override', () => {
  beforeEach(() => {
    listMisEmailRoutingRules.mockReset();
    resolveRoutingClientNamesForScope.mockReset();
    resolveRoutingScopeForOfficeIds.mockReset();
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReset();
    fetchDigestSummaryDataCached.mockReset();
    fetchDigestClientAccountSummaryCached.mockReset();
    fetchDigestRegisterRows.mockReset();
    buildDigestAttachments.mockReset();
    buildDigestTraceableExportPayload.mockReset();

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

  it('allows explicit To even when routing disables auto-send', async () => {
    await expect(
      sendMisEmailComposeBatch(emptyRecipient as never, {
        sendTo: ['manual@example.com'],
      })
    ).rejects.toThrow(/Select at least one report attachment/);
  });

  it('blocks when routing disables auto-send and no explicit To', async () => {
    await expect(sendMisEmailComposeBatch(emptyRecipient as never, {})).rejects.toThrow(
      /Auto-send disabled/
    );
  });

  it('no matching routing rule does not throw auto-send disabled', async () => {
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReturnValue([]);
    await expect(
      sendMisEmailComposeBatch(emptyRecipient as never, {
        sendTo: ['manual@example.com'],
      })
    ).rejects.toThrow(/Select at least one report attachment/);
  });
});

describe('buildMisEmailPayload early exits', () => {
  beforeEach(() => {
    fetchDigestSummaryDataCached.mockReset();
    fetchDigestClientAccountSummaryCached.mockReset();
    fetchDigestRegisterRows.mockReset();
    buildDigestAttachments.mockReset();
    buildDigestTraceableExportPayload.mockReset();
  });

  it('rejects with no includes before fetching summary', async () => {
    await expect(
      buildMisEmailPayload(emptyRecipient as never, {
        sentTo: 'user@example.com',
        displayName: 'User',
      })
    ).rejects.toThrow(/Select at least one report attachment/);
    expect(fetchDigestSummaryDataCached).not.toHaveBeenCalled();
    expect(fetchDigestRegisterRows).not.toHaveBeenCalled();
  });

  it('forPreview skips register fetch and Excel builders', async () => {
    fetchDigestSummaryDataCached.mockResolvedValue({
      branchSummary: [],
      accountSummary: [],
      totals: {},
    });

    const result = await buildMisEmailPayload(summaryRecipient as never, {
      sentTo: 'user@example.com',
      displayName: 'User',
      forPreview: true,
    });

    expect(result.emailAttachments).toEqual([]);
    expect(result.preview.attachments.length).toBeGreaterThan(0);
    expect(fetchDigestSummaryDataCached).toHaveBeenCalledOnce();
    expect(fetchDigestRegisterRows).not.toHaveBeenCalled();
    expect(buildDigestAttachments).not.toHaveBeenCalled();
  });
});

describe('resolveMisEmailSendTargets', () => {
  it('uses sendTo override when provided', () => {
    expect(
      resolveMisEmailSendTargets(
        emptyRecipient as never,
        { toEmails: ['stored@example.com'] },
        ['Override@Example.com']
      )
    ).toEqual(['override@example.com']);
  });

  it('uses preference toEmails when no override', () => {
    expect(
      resolveMisEmailSendTargets(emptyRecipient as never, {
        toEmails: ['a@example.com', 'b@example.com'],
      })
    ).toEqual(['a@example.com', 'b@example.com']);
  });

  it('falls back to recipient email when toEmails empty', () => {
    expect(resolveMisEmailSendTargets(emptyRecipient as never, { toEmails: [] })).toEqual([
      'user@example.com',
    ]);
  });
});
