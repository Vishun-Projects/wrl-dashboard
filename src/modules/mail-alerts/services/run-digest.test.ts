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
const resolveRoutingScheduleSlotStart = vi.fn(() => new Date('2026-07-08T04:00:00.000Z'));
const hasSuccessfulRoutingSendInSlot = vi.fn(async () => false);

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
  DEFAULT_MIS_EMAIL_PREFERENCES: { dateRange: 'mtd' },
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

vi.mock('@/modules/mail-alerts/services/routing-rules', () => ({
  listMisEmailRoutingRules: (...args: unknown[]) => listMisEmailRoutingRules(...args),
  resolveRoutingScopeForOfficeIds: (...args: unknown[]) => resolveRoutingScopeForOfficeIds(...args),
  resolveRoutingClientNamesForScope: (...args: unknown[]) =>
    resolveRoutingClientNamesForScope(...args),
  listMatchingMisEmailRoutingRulesForResolvedClients: (...args: unknown[]) =>
    listMatchingMisEmailRoutingRulesForResolvedClients(...args),
  shouldTriggerRoutingRuleNow: (...args: unknown[]) => shouldTriggerRoutingRuleNow(...args),
  logMisEmailRoutingSendAttempt: (...args: unknown[]) => logMisEmailRoutingSendAttempt(...args),
  resolveRoutingScheduleSlotStart: () => resolveRoutingScheduleSlotStart(),
  hasSuccessfulRoutingSendInSlot: () => hasSuccessfulRoutingSendInSlot(),
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

const catchAllRule = {
  ...enabledRule,
  id: 'r-catch-all',
  zone: '',
  branch: '',
  client: '',
  toEmails: ['catch@example.com'],
  ccEmails: [],
  scheduleAnchorTimeIst: '07:00',
};

vi.mock('@/lib/vps-cron/settings', () => ({
  isVpsCronPaused: vi.fn(async () => false),
}));

vi.mock('@/lib/security/audit', () => ({
  logAction: vi.fn(async () => undefined),
}));

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
    resolveRoutingScheduleSlotStart.mockClear();
    hasSuccessfulRoutingSendInSlot.mockReset();
    hasSuccessfulRoutingSendInSlot.mockResolvedValue(false);

    resolveRoutingScopeForOfficeIds.mockResolvedValue({
      zones: ['NORTH'],
      branches: ['DELHI BRANCH'],
    });
    resolveRoutingClientNamesForScope.mockResolvedValue({ mail: [], crm: [] });
  });

  it('still sends personal digest when matched rule disables auto-send', async () => {
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
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReturnValue([disabledRule]);
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

    const { runMisEmailDigest } = await import('@/modules/mail-alerts/services/run-digest');
    const result = await runMisEmailDigest();
    expect(shouldTriggerRoutingRuleNow).toHaveBeenCalledWith(
      enabledRule,
      expect.objectContaining({ windowMinutes: expect.any(Number) })
    );
    // Personal digest to user + routing digest to rule To (routing uses rule schedule, not personal time).
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

  it('sends only via the best matching rule when multiple rules match', async () => {
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
    // Sorted best-first (zone rule before catch-all), as listMatching does.
    listMatchingMisEmailRoutingRulesForResolvedClients.mockReturnValue([
      enabledRule,
      catchAllRule,
    ]);
    listMisEmailRoutingRules.mockResolvedValue([enabledRule, catchAllRule]);
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
    // Personal + best matching rule only (not catch-all).
    expect(sendDigestEmail).toHaveBeenCalledTimes(2);
    expect(sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@example.com',
        cc: ['cc@example.com'],
      })
    );
    expect(result.sent).toHaveLength(2);
  });
});
