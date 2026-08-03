import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDigestRecipients = vi.fn();
const loadDigestRecipientByEmail = vi.fn();
const loadAppUserProfileByEmail = vi.fn();
const buildMisEmailPayload = vi.fn();
const sendDigestEmail = vi.fn();
const listMisEmailRoutingRules = vi.fn();
const resolveOfficeIdsForRoutingRule = vi.fn();
const shouldTriggerRoutingRuleNow = vi.fn();
const logMisEmailRoutingSendAttempt = vi.fn();
const resolveRoutingScheduleSlotStart = vi.fn(() => new Date('2026-07-08T04:00:00.000Z'));
const hasSuccessfulRoutingSendInSlot = vi.fn(async () => false);
const getMisEmailOrgSettings = vi.fn(async () => ({
  defaultDateRange: 'year_to_yesterday',
}));

vi.mock('@/modules/mail-alerts/services/recipients', () => ({
  loadDigestRecipients: (...args: unknown[]) => loadDigestRecipients(...args),
  loadDigestRecipientByEmail: (...args: unknown[]) => loadDigestRecipientByEmail(...args),
  loadAppUserProfileByEmail: (...args: unknown[]) => loadAppUserProfileByEmail(...args),
  loadDigestRecipientById: vi.fn(),
}));

vi.mock('@/modules/mail-alerts/services/compose-digest', () => ({
  buildMisEmailPayload: (...args: unknown[]) => buildMisEmailPayload(...args),
}));

vi.mock('@/modules/mail-alerts/services/send', () => ({
  sendDigestEmail: (...args: unknown[]) => sendDigestEmail(...args),
}));

vi.mock('@/modules/mail-alerts/services/preferences', () => ({
  DEFAULT_MIS_EMAIL_PREFERENCES: { dateRange: 'mtd', includeOpenCallsExport: false },
  defaultPreferencesForRecipient: vi.fn(() => ({
    subscribed: true,
    dateRange: 'year_to_yesterday',
    includeSummary: true,
    includeDetailed: true,
    includeKeyAccount: true,
    includeOpenCallsExport: false,
    bodyInEmail: ['regional_performance', 'branch_performance', 'key_account_performance'],
    keyAccountsInBody: [],
    keyAccountsByZone: {},
    toEmails: [],
    ccEmails: [],
  })),
  parseMisEmailKeyAccountsInBody: vi.fn((raw: unknown) => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const name = item.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(name);
    }
    return result;
  }),
  normalizeMisEmailSendTime: vi.fn((value: unknown) =>
    typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : null
  ),
  resolveMisEmailSendTimeIst: vi.fn(() => '09:30'),
  resolveDigestDateRangeForPreferences: vi.fn(() => ({ label: 'Month to date' })),
  resolvePersonalDigestTargets: vi.fn((_prefs: unknown, email: string) => ({
    to: [email],
    cc: [],
  })),
  shouldSendMisEmailNow: vi.fn(() => true),
}));

vi.mock('@/modules/mail-alerts/services/org-settings', () => ({
  getMisEmailOrgSettings,
}));

vi.mock('@/modules/mail-alerts/services/routing-rules', () => ({
  listMisEmailRoutingRules,
  resolveOfficeIdsForRoutingRule,
  shouldTriggerRoutingRuleNow,
  logMisEmailRoutingSendAttempt,
  resolveRoutingScheduleSlotStart,
  hasSuccessfulRoutingSendInSlot,
}));

const disabledRule = {
  id: 'r1',
  zone: 'NORTH',
  branch: '',
  client: '',
  toEmails: ['u@example.com'],
  ccEmails: [],
  autoSendEnabled: false,
  scheduleAnchorTimeIst: '07:00',
  scheduleIntervalMinutes: 1440,
  scheduleDaysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  scheduleWindowStartIst: null,
  scheduleWindowEndIst: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const enabledRule = {
  ...disabledRule,
  id: 'r-enabled',
  toEmails: ['to@example.com'],
  ccEmails: ['cc@example.com'],
  autoSendEnabled: true,
};

const scopedRule = {
  ...enabledRule,
  id: 'r-scoped',
  zone: 'EAST ZONE',
  branch: '1127 - GUWAHATI BRANCH',
  toEmails: ['vishnu@example.com'],
  ccEmails: [],
  scheduleAnchorTimeIst: '10:30',
};

vi.mock('@/lib/vps-cron/settings', () => ({
  isVpsCronPaused: vi.fn(async () => false),
}));

vi.mock('@/lib/security/audit', () => ({
  logAction: vi.fn(async () => undefined),
}));

describe('runMisEmailDigest rule-driven routing', () => {
  beforeEach(() => {
    vi.resetModules();
    loadDigestRecipients.mockReset();
    loadDigestRecipientByEmail.mockReset();
    loadAppUserProfileByEmail.mockReset();
    buildMisEmailPayload.mockReset();
    sendDigestEmail.mockReset();
    listMisEmailRoutingRules.mockReset();
    resolveOfficeIdsForRoutingRule.mockReset();
    shouldTriggerRoutingRuleNow.mockReset();
    logMisEmailRoutingSendAttempt.mockReset();
    resolveRoutingScheduleSlotStart.mockClear();
    hasSuccessfulRoutingSendInSlot.mockReset();
    hasSuccessfulRoutingSendInSlot.mockResolvedValue(false);
    resolveOfficeIdsForRoutingRule.mockResolvedValue([]);
    getMisEmailOrgSettings.mockResolvedValue({ defaultDateRange: 'year_to_yesterday' });
  });

  it('still sends personal digest when routing auto-send is off', async () => {
    loadDigestRecipients.mockResolvedValue([
      {
        id: 'u1',
        name: 'User',
        email: 'u@example.com',
        role: 'branch_manager',
        office_ids: ['1'],
        permissions: [],
        mis_email_preferences: {},
      },
    ]);
    loadDigestRecipientByEmail.mockResolvedValue(null);
    loadAppUserProfileByEmail.mockResolvedValue(null);
    listMisEmailRoutingRules.mockResolvedValue([disabledRule]);
    shouldTriggerRoutingRuleNow.mockReturnValue(true);
    buildMisEmailPayload.mockResolvedValue({
      preview: { attachments: ['a.xlsx'], subject: 'Subject' },
      emailAttachments: [],
      scopeLabel: 'Scope',
      bodyHtml: '',
      bodyPlainText: '',
      dateRange: { label: 'Month to date' },
    });
    sendDigestEmail.mockResolvedValue({ messageId: 'm1' });

    const { runMisEmailDigest } = await import('@/modules/mail-alerts/services/run-digest');
    const result = await runMisEmailDigest();
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0].sentTo).toBe('u@example.com');
    expect(result.skipped.some((s) => s.reason.includes('Routing auto-send off'))).toBe(true);
    expect(sendDigestEmail).toHaveBeenCalledTimes(1);
  });

  it('sends routing To+Cc from the rule without needing a matching digest user', async () => {
    loadDigestRecipients.mockResolvedValue([]);
    listMisEmailRoutingRules.mockResolvedValue([scopedRule]);
    shouldTriggerRoutingRuleNow.mockReturnValue(true);
    resolveOfficeIdsForRoutingRule.mockResolvedValue(['1127']);
    buildMisEmailPayload.mockResolvedValue({
      preview: { attachments: ['a.xlsx'], subject: 'Subject' },
      emailAttachments: [],
      scopeLabel: 'Guwahati',
      bodyHtml: '',
      bodyPlainText: '',
      dateRange: { label: 'Year to yesterday' },
    });
    sendDigestEmail.mockResolvedValue({ messageId: 'm1' });

    const { runMisEmailDigest } = await import('@/modules/mail-alerts/services/run-digest');
    const result = await runMisEmailDigest();

    expect(shouldTriggerRoutingRuleNow).toHaveBeenCalledWith(
      scopedRule,
      expect.objectContaining({ windowMinutes: expect.any(Number) })
    );
    expect(resolveOfficeIdsForRoutingRule).toHaveBeenCalledWith(scopedRule);
    expect(buildMisEmailPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        office_ids: ['1127'],
        includeSummary: true,
        includeDetailed: true,
        includeKeyAccount: true,
        mis_email_preferences: expect.objectContaining({
          includeOpenCallsExport: true,
          bodyLayout: expect.objectContaining({ mode: 'grid', mergeKeyAccountRegions: true }),
          bodyInEmail: expect.arrayContaining([
            'regional_performance',
            'branch_performance',
            'key_account_performance',
          ]),
        }),
      }),
      expect.any(Object)
    );
    expect(sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vishnu@example.com',
      })
    );
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0].sentTo).toBe('vishnu@example.com');
  });

  it('sends each due auto-send rule once (not best-match only)', async () => {
    loadDigestRecipients.mockResolvedValue([]);
    listMisEmailRoutingRules.mockResolvedValue([enabledRule, scopedRule]);
    shouldTriggerRoutingRuleNow.mockReturnValue(true);
    resolveOfficeIdsForRoutingRule.mockResolvedValue([]);
    buildMisEmailPayload.mockResolvedValue({
      preview: { attachments: ['a.xlsx'], subject: 'Subject' },
      emailAttachments: [],
      scopeLabel: 'Scope',
      bodyHtml: '',
      bodyPlainText: '',
      dateRange: { label: 'Month to date' },
    });
    sendDigestEmail.mockResolvedValue({ messageId: 'm1' });

    const { runMisEmailDigest } = await import('@/modules/mail-alerts/services/run-digest');
    const result = await runMisEmailDigest();
    expect(sendDigestEmail).toHaveBeenCalledTimes(2);
    expect(result.sent).toHaveLength(2);
    expect(result.sent.map((s) => s.sentTo).sort()).toEqual(
      ['to@example.com', 'vishnu@example.com'].sort()
    );
  });

  it('skips routing send when slot already sent', async () => {
    loadDigestRecipients.mockResolvedValue([]);
    listMisEmailRoutingRules.mockResolvedValue([enabledRule]);
    shouldTriggerRoutingRuleNow.mockReturnValue(true);
    hasSuccessfulRoutingSendInSlot.mockResolvedValue(true);
    buildMisEmailPayload.mockResolvedValue({
      preview: { attachments: [], subject: 'Subject' },
      emailAttachments: [],
      scopeLabel: 'Scope',
      bodyHtml: '',
      bodyPlainText: '',
      dateRange: { label: 'Month to date' },
    });

    const { runMisEmailDigest } = await import('@/modules/mail-alerts/services/run-digest');
    const result = await runMisEmailDigest();
    expect(sendDigestEmail).not.toHaveBeenCalled();
    expect(result.sent).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.includes('already sent'))).toBe(true);
  });

  it('uses To + CC from enabled routing rule alongside personal digest', async () => {
    loadDigestRecipients.mockResolvedValue([
      {
        id: 'u1',
        name: 'User',
        email: 'u@example.com',
        role: 'branch_manager',
        office_ids: ['1'],
        permissions: [],
        mis_email_preferences: {},
      },
    ]);
    loadDigestRecipientByEmail.mockResolvedValue(null);
    loadAppUserProfileByEmail.mockResolvedValue(null);
    listMisEmailRoutingRules.mockResolvedValue([enabledRule]);
    shouldTriggerRoutingRuleNow.mockReturnValue(true);
    buildMisEmailPayload.mockResolvedValue({
      preview: { attachments: ['a.xlsx'], subject: 'Subject' },
      emailAttachments: [],
      scopeLabel: 'Scope',
      bodyHtml: '',
      bodyPlainText: '',
      dateRange: { label: 'Month to date' },
    });
    sendDigestEmail.mockResolvedValue({ messageId: 'm1' });

    const { runMisEmailDigest } = await import('@/modules/mail-alerts/services/run-digest');
    const result = await runMisEmailDigest();
    expect(sendDigestEmail).toHaveBeenCalledTimes(2);
    expect(sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@example.com',
        cc: ['cc@example.com'],
      })
    );
    expect(result.sent).toHaveLength(2);
    expect(result.sent.some((s) => s.sentTo === 'to@example.com')).toBe(true);
    expect(result.sent.some((s) => s.sentTo === 'u@example.com')).toBe(true);
  });
});
