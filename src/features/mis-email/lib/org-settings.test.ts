import { describe, expect, it } from 'vitest';
import {
  MIS_EMAIL_ORG_SETTINGS_FALLBACKS,
  mergeMisEmailOrgSettings,
} from '@/features/mis-email/lib/org-settings';
import {
  DEFAULT_MIS_EMAIL_CC_EMAILS,
  DEFAULT_MIS_EMAIL_TO_EMAILS,
} from '@/features/mis-email/lib/default-recipients';

describe('mergeMisEmailOrgSettings', () => {
  it('empty DB matches today’s hardcodes', () => {
    const settings = mergeMisEmailOrgSettings(null);
    expect(settings.defaultToEmails).toEqual(DEFAULT_MIS_EMAIL_TO_EMAILS);
    expect(settings.defaultCcEmails).toEqual(DEFAULT_MIS_EMAIL_CC_EMAILS);
    expect(settings.defaultSendTimeIst).toBe('09:30');
    expect(settings.defaultDateRange).toBe('month_to_date');
    expect(settings.subjectTemplate).toBe('Daily MIS Report as on {asOn}');
    expect(settings.greeting).toBe('Dear Zonal Heads,');
    expect(settings.brandTitle).toBe('WESTERN REFRIGERATION');
    expect(settings.brandSubtitle).toBe('WRL Dashboard');
    expect(settings.portalBaseUrl).toBe('https://wrl-dashboard.vercel.app');
    expect(settings.digestCallType).toBe('BREAKDOWN');
    expect(settings.allowedEmailDomains).toEqual(['westernequipments.com']);
    // Preserve existing digests until admin explicitly turns outbound off.
    expect(settings.outboundMailEnabled).toBe(true);
    expect(settings).toEqual(MIS_EMAIL_ORG_SETTINGS_FALLBACKS);
  });

  it('applies stored overrides', () => {
    const settings = mergeMisEmailOrgSettings({
      greeting: 'Dear Team,',
      outboundMailEnabled: false,
      allowedEmailDomains: ['westernequipments.com', 'western.com'],
      subjectTemplate: 'MIS {asOn}',
    });
    expect(settings.greeting).toBe('Dear Team,');
    expect(settings.outboundMailEnabled).toBe(false);
    expect(settings.allowedEmailDomains).toEqual(['westernequipments.com', 'western.com']);
    expect(settings.subjectTemplate).toBe('MIS {asOn}');
    expect(settings.defaultSendTimeIst).toBe('09:30');
  });
});
