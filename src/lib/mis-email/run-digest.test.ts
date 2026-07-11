import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDigestRecipients = vi.fn();
const loadDigestRecipientByEmail = vi.fn();
const loadAppUserProfileByEmail = vi.fn();
const buildMisEmailPayload = vi.fn();
const sendDigestEmail = vi.fn();
const listMisEmailRoutingRules = vi.fn();
const resolveRoutingScopeForOfficeIds = vi.fn();
const resolveRoutingClientNamesForScope = vi.fn();
const listMatchingMisEmailRoutingRulesForResolvedClients = vi.fn();
const shouldTriggerRoutingRuleNow = vi.fn();
const logMisEmailRoutingSendAttempt = vi.fn();

vi.mock('@/lib/mis-email/recipients', () => ({
  loadDigestRecipients: (...args: unknown[]) => loadDigestRecipients(...args),
  loadDigestRecipientByEmail: (...args: unknown[]) => loadDigestRecipientByEmail(...args),
  loadAppUserProfileByEmail: (...args: unknown[]) => loadAppUserProfileByEmail(...args),
  loadDigestRecipientById: vi.fn(),
}));

vi.mock('@/lib/mis-email/compose-digest', () => ({
  buildMisEmailPayload: (...args: unknown[]) => buildMisEmailPayload(...args),
}));

vi.mock('@/lib/mis-email/send', () => ({
  sendDigestEmail: (...args: unknown[]) => sendDigestEmail(...args),
}));

vi.mock('@/lib/mis-email/preferences', () => ({
  DEFAULT_MIS_EMAIL_PREFERENCES: { dateRange: 'mtd' },
  normalizeMisEmailSendTime: vi.fn((value: unknown) =>
    typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : null
  ),
  resolveMisEmailSendTimeIst: vi.fn(() => '07:00'),
  resolveDigestDateRangeForPreferences: vi.fn(() => ({ label: 'Month to date' })),
  resolveExtraDigestEmails: vi.fn(() => []),
  shouldSendMisEmailNow: vi.fn(() => true),
}));

vi.mock('@/lib/mis-email/routing-rules', () => ({
  listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
  resolveRoutingScopeForOfficeIds: (...args: unknown[]) => resolveRoutingScopeForOfficeIds(...args),
  resolveRoutingClientNamesForScope: (...args: unknown[]) =>
    resolveRoutingClientNamesForScope(...args),
  listMatchingMisEmailRoutingRulesForResolvedClients: (...args: unknown[]) =>
    listMatchingMisEmailRoutingRulesForResolvedClients(...args),
  shouldTriggerRoutingRuleNow: (...args: unknown[]) => shouldTriggerRoutingRuleNow(...args),
  logMisEmailRoutingSendAttempt: (...args: unknown[]) => logMisEmailRoutingSendAttempt(...args),
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
  toEmails: ['to@example.com'],
  ccEmails: ['cc@example.com'],
  autoSendEnabled: true,
};

describe('runMisEmailDigest routing override', () => {
  beforeEach(() => {
    loadDigestRecipients.mockReset();
    loadDigestRecipientByEmail.mockReset();
    loadAppUserProfileByEmail.mockReset();
    buildMisEmailPayload.mockReset();
    sendDigestEmail.mockReset();
    listMisEmailRoutingRules.mockReset();
    resolveRoutingScopeForOfficeIds.mockReset();
    resolveRoutingClientNamesForScope.mockReset();
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReset();
    shouldTriggerRoutingRuleNow.mockReset();
    logMisEmailRoutingSendAttempt.mockReset();

    resolveRoutingScopeForOfficeIds.mockResolvedValue({
      zones: ['NORTH'],
      branches: ['DELHI BRANCH'],
    });
    resolveRoutingClientNamesForScope.mockResolvedValue({ mail: [], crm: [] });
  });

  it('skips recipient when matched rule disables auto-send', async () => {
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
    listMisEmailRoutingRules.mockResolvedValue([disabledRule]);
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReturnValue([disabledRule]);
    shouldTriggerRoutingRuleNow.mockReturnValue(true);

    const { runMisEmailDigest } = await import('@/lib/mis-email/run-digest');
    const result = await runMisEmailDigest();
    expect(result.sent).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.includes('Auto-send disabled by HOD routing rule'))).toBe(
      true
    );
    expect(sendDigestEmail).not.toHaveBeenCalled();
  });

  it('uses To + CC recipients from matched routing rule', async () => {
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
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReturnValue([enabledRule]);
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

    const { runMisEmailDigest } = await import('@/lib/mis-email/run-digest');
    const result = await runMisEmailDigest();
    expect(sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@example.com',
        cc: ['cc@example.com'],
      })
    );
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0].sentTo).toBe('to@example.com');
  });
});
