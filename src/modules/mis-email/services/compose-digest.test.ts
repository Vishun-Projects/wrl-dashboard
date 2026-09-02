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

vi.mock('@/modules/mis-email/services/routing-rules', () => ({
  listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
  resolveRoutingClientNamesForScope: (...args: unknown[]) =>
    resolveRoutingClientNamesForScope(...args),
  resolveRoutingScopeForOfficeIds: (...args: unknown[]) => resolveRoutingScopeForOfficeIds(...args),
  listMatchingMisEmailRoutingRulesForResolvedClients: (...args: unknown[]) =>
    listMatchingMisEmailRoutingRulesForResolvedClients(...args),
}));

vi.mock('@/modules/mis-email/services/send', () => ({
  resolvePortalUrl: vi.fn((u?: string) => u || 'http://localhost/report'),
  sendPreparedDigestEmail: vi.fn(),
}));

vi.mock('@/modules/mis-email/services/org-settings', () => ({
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

vi.mock('@/modules/mis-email/services/user-scope', () => ({
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

vi.mock('@/modules/mis-email/services/digest-cache', () => ({
  fetchDigestSummaryDataCached: (...args: unknown[]) => fetchDigestSummaryDataCached(...args),
  fetchDigestClientAccountSummaryCached: (...args: unknown[]) =>
    fetchDigestClientAccountSummaryCached(...args),
  clearDigestSummaryCache: vi.fn(),
}));

vi.mock('@/modules/mis-email/services/fetch-digest-data', () => ({
  fetchDigestRegisterRows: (...args: unknown[]) => fetchDigestRegisterRows(...args),
}));

vi.mock('@/modules/mis-email/services/build-attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/mis-email/services/build-attachments')>();
  return {
    ...actual,
    buildDigestAttachments: (...args: unknown[]) => buildDigestAttachments(...args),
  };
});

vi.mock('@/modules/mis-email/services/fetch-digest-trace', () => ({
  buildDigestTraceableExportPayload: (...args: unknown[]) =>
    buildDigestTraceableExportPayload(...args),
}));

vi.mock('@/modules/mis-email/services/mail-basis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/mis-email/services/mail-basis')>();
  return {
    ...actual,
    buildMisEmailSummaryDashboardBodyRows: vi.fn(async () => ({
      regional: [
        {
          region: 'EAST ZONE',
          total_calls: 40,
          solved_calls: 10,
          cancelled_calls: 0,
          open_calls: 30,
          age_2: 0,
          age_3: 0,
          age_7: 0,
          age_15: 0,
          part_pending: 0,
          active_eng: 0,
        },
      ],
      branch: [],
    })),
  };
});

// Static import after mocks — avoids cold dynamic-import eating the test timeout.
const {
  buildMisEmailPayload,
  resolveMisEmailSendTargets,
  sendMisEmailComposeBatch,
} = await import('@/modules/mis-email/services/compose-digest');

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

  it('forPreview uses summary for body and skips Excel builders and full/open trace', async () => {
    fetchDigestSummaryDataCached.mockResolvedValue({
      branchSummary: [],
      accountSummary: [],
      totals: {},
    });
    fetchDigestClientAccountSummaryCached.mockResolvedValue([]);
    fetchDigestRegisterRows.mockResolvedValue([{ id: 1 }]);

    const result = await buildMisEmailPayload(
      {
        ...summaryRecipient,
        mis_email_preferences: {
          ...summaryRecipient.mis_email_preferences,
          bodyInEmail: ['regional_performance', 'branch_performance'],
        },
      } as never,
      {
        sentTo: 'user@example.com',
        displayName: 'User',
        forPreview: true,
      }
    );

    expect(result.emailAttachments).toEqual([]);
    expect(result.preview.attachments.length).toBeGreaterThan(0);
    expect(fetchDigestSummaryDataCached).toHaveBeenCalledOnce();
    expect(fetchDigestRegisterRows).toHaveBeenCalledOnce();
    expect(buildDigestAttachments).not.toHaveBeenCalled();
    expect(buildDigestTraceableExportPayload).not.toHaveBeenCalled();
  });

  it('does not filter excel data/trace payload by selected accounts but filters body keyAccountRows', async () => {
    fetchDigestSummaryDataCached.mockResolvedValue({
      branchSummary: [],
      accountSummary: [
        { account: 'COKE', open_calls: 5 },
        { account: 'CADBURY', open_calls: 10 },
        { account: 'PEPSI', open_calls: 15 },
      ],
      totals: {},
    });
    fetchDigestClientAccountSummaryCached.mockResolvedValue([
      { account: 'COKE', open_calls: 5 },
      { account: 'CADBURY', open_calls: 10 },
      { account: 'PEPSI', open_calls: 15 },
    ]);
    buildDigestTraceableExportPayload.mockResolvedValue({
      regionalRows: [],
      grand: { region: 'ALL', open_calls: 0 },
      crmBranchSummary: [],
      crmAccountSummary: [],
      clientAccountSummary: [],
      sources: {},
      traceRows: [
        { client: 'COKE', open_calls: 5 },
        { client: 'CADBURY', open_calls: 10 },
        { client: 'PEPSI', open_calls: 15 },
      ],
      traceAlign: 'summary',
      filterMeta: {},
    });
    buildDigestAttachments.mockResolvedValue([
      { filename: 'Trace_Report.xlsx', content: Buffer.from('mock content') }
    ]);

    const result = await buildMisEmailPayload(
      {
        ...summaryRecipient,
        includeKeyAccount: true,
        mis_email_preferences: {
          ...summaryRecipient.mis_email_preferences,
          includeDetailed: false,
          includeTraceableExport: true,
          keyAccountsInBody: ['COKE', 'CADBURY'],
          bodyInEmail: ['key_account_performance'],
        },
      } as never,
      {
        sentTo: 'user@example.com',
        displayName: 'User',
      }
    );

    // Assert buildDigestAttachments is called with UNFILTERED data
    expect(buildDigestAttachments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountSummary: expect.arrayContaining([
          expect.objectContaining({ account: 'COKE' }),
          expect.objectContaining({ account: 'CADBURY' }),
          expect.objectContaining({ account: 'PEPSI' }),
        ]),
      }),
      expect.objectContaining({
        tracePayload: expect.objectContaining({
          traceRows: expect.arrayContaining([
            expect.objectContaining({ client: 'COKE' }),
            expect.objectContaining({ client: 'CADBURY' }),
            expect.objectContaining({ client: 'PEPSI' }),
          ]),
        }),
      })
    );

    // Assert that the preview indicates only the selected accounts are in the body
    expect(result.preview.keyAccountRowsInBody).toBe(2); // COKE and CADBURY
  });

  it('shows only selected key accounts in key accounts section, while files and regional/branch body sections show overall ones', async () => {
    fetchDigestSummaryDataCached.mockResolvedValue({
      branchSummary: [
        { branch: '1127 - GUWAHATI BRANCH', open_calls: 5 },
      ],
      accountSummary: [
        { account: 'COKE', open_calls: 5 },
        { account: 'CADBURY', open_calls: 10 },
        { account: 'PEPSI', open_calls: 15 },
      ],
      totals: {},
    });
    fetchDigestClientAccountSummaryCached.mockResolvedValue([
      { account: 'COKE', open_calls: 5 },
      { account: 'CADBURY', open_calls: 10 },
      { account: 'PEPSI', open_calls: 15 },
    ]);
    buildDigestTraceableExportPayload.mockResolvedValue({
      regionalRows: [
        { region: 'EAST', open_calls: 30, solved_calls: 10 },
      ],
      grand: { region: 'ALL', open_calls: 30 },
      crmBranchSummary: [],
      crmAccountSummary: [],
      clientAccountSummary: [],
      sources: {},
      traceRows: [
        ...Array.from({ length: 5 }, () => ({ client: 'COKE', region: 'EAST', plant: '1127 - GUWAHATI BRANCH', counts_toward: 'open', included_in_final_count: true, aging: '<2 days' })),
        ...Array.from({ length: 2 }, () => ({ client: 'COKE', region: 'EAST', plant: '1127 - GUWAHATI BRANCH', counts_toward: 'solved', included_in_final_count: true })),
        ...Array.from({ length: 10 }, () => ({ client: 'CADBURY', region: 'EAST', plant: '1127 - GUWAHATI BRANCH', counts_toward: 'open', included_in_final_count: true, aging: '3-7 days' })),
        ...Array.from({ length: 3 }, () => ({ client: 'CADBURY', region: 'EAST', plant: '1127 - GUWAHATI BRANCH', counts_toward: 'solved', included_in_final_count: true })),
        ...Array.from({ length: 15 }, () => ({ client: 'PEPSI', region: 'EAST', plant: '1127 - GUWAHATI BRANCH', counts_toward: 'open', included_in_final_count: true, aging: '8-15 days' })),
        ...Array.from({ length: 5 }, () => ({ client: 'PEPSI', region: 'EAST', plant: '1127 - GUWAHATI BRANCH', counts_toward: 'solved', included_in_final_count: true })),
      ] as any[],
      traceAlign: 'summary',
      filterMeta: {},
    });
    buildDigestAttachments.mockResolvedValue([
      { filename: 'Trace_Report.xlsx', content: Buffer.from('mock content') }
    ]);

    const result = await buildMisEmailPayload(
      {
        ...summaryRecipient,
        includeKeyAccount: true,
        mis_email_preferences: {
          ...summaryRecipient.mis_email_preferences,
          includeDetailed: false,
          includeTraceableExport: true,
          keyAccountsInBody: ['COKE', 'CADBURY'],
          bodyInEmail: ['key_account_performance', 'regional_performance'],
        },
      } as never,
      {
        sentTo: 'user@example.com',
        displayName: 'User',
      }
    );

    // 1. Assert Key Account Rows in body shows only selected (2 rows: COKE and CADBURY)
    expect(result.preview.keyAccountRowsInBody).toBe(2);

    // 2. Assert that buildDigestAttachments was called with the overall/unfiltered ones
    expect(buildDigestAttachments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountSummary: expect.arrayContaining([
          expect.objectContaining({ account: 'COKE' }),
          expect.objectContaining({ account: 'CADBURY' }),
          expect.objectContaining({ account: 'PEPSI' }),
        ]),
      }),
      expect.objectContaining({
        tracePayload: expect.objectContaining({
          traceRows: expect.arrayContaining([
            expect.objectContaining({ client: 'COKE' }),
            expect.objectContaining({ client: 'CADBURY' }),
            expect.objectContaining({ client: 'PEPSI' }),
          ]),
        }),
      })
    );

    // 3. Assert that the rest of the body (e.g. regionalPerformanceRows) shows overall/unfiltered ones
    // We expect the html/plaintext to contain regional/overall stats including all open calls (30 calls total)
    expect(result.preview.plainText).toContain('EAST: total 40, solved 10, cancelled 0, open 30');
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
