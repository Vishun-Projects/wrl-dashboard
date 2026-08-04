import {
  DEFAULT_MIS_EMAIL_CC_EMAILS,
  DEFAULT_MIS_EMAIL_TO_EMAILS,
} from '@/modules/mis-email/services/default-recipients';
import type { MisEmailDateRangeMode } from '@/modules/mis-email/services/preferences';

/** Seed allowlist when DB empty / unset. */
export const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['westernequipments.com'] as const;

export const DEFAULT_WATCHDOG_TO_EMAIL = 'vishnu.vishwakarma@westernequipments.com';

export const DEFAULT_WATCHDOG_SUBJECT_TEMPLATE =
  'Morning MIS digest — attention required ({date})';

export const DEFAULT_WATCHDOG_BODY_TEMPLATE = `Hello,

This is an automated note from the MIS reporting service.

The scheduled morning MIS digest for {date} does not appear to have completed successfully. Customer-facing digests are separate from this notice; no further action is required from report recipients.

Summary for IT / operations:
  {reason}

Suggested next steps (for the on-call admin):
  1. Review today's digest log on the VPS host.
  2. If needed, re-run the digest from the VPS host.
  3. Confirm the MIS email digest job is Active under Mail & Alerts → VPS Cron.

Kind regards,
WRL MIS reporting
`;

export type MisEmailOrgSettings = {
  defaultToEmails: string[];
  defaultCcEmails: string[];
  defaultSendTimeIst: string;
  defaultDateRange: MisEmailDateRangeMode;
  subjectTemplate: string;
  /** Subject when sending as revised (full template; not auto-suffixed). */
  subjectTemplateRevised: string;
  greeting: string;
  brandTitle: string;
  brandSubtitle: string;
  portalBaseUrl: string;
  digestCallType: string;
  /** Digest body intro under the greeting (normal send). */
  introTextNormal: string;
  /** Digest body intro when sending as revised. */
  introTextRevised: string;
  allowedEmailDomains: string[];
  /**
   * Org-wide outbound kill switch.
   * Code fallback is true so empty DB does not stop existing digests.
   * Admin can set false; new routing rules still default auto_send off.
   */
  outboundMailEnabled: boolean;
  majorRepairMinCount: number;
  majorRepairMonths: number;
  majorRepairDefaultTo: string;
  majorRepairDefaultCc: string;
  /** Morning watchdog alert recipient (env MIS_EMAIL_WATCHDOG_TO overrides). */
  watchdogToEmail: string;
  /** Placeholders: {date} */
  watchdogSubjectTemplate: string;
  /** Placeholders: {date}, {reason} */
  watchdogBodyTemplate: string;
};

/** Fallbacks = today's hardcodes (empty DB → no silent prod change). */
export const MIS_EMAIL_ORG_SETTINGS_FALLBACKS: MisEmailOrgSettings = {
  defaultToEmails: [...DEFAULT_MIS_EMAIL_TO_EMAILS],
  defaultCcEmails: [...DEFAULT_MIS_EMAIL_CC_EMAILS],
  defaultSendTimeIst: '09:30',
  defaultDateRange: 'month_to_date',
  subjectTemplate: 'Daily MIS Report as on {asOn}',
  subjectTemplateRevised: 'Daily MIS Report as on {asOn} (Revised)',
  greeting: 'Dear Zonal Heads,',
  brandTitle: 'WESTERN REFRIGERATION',
  brandSubtitle: 'WRL Dashboard',
  portalBaseUrl: 'https://wrl-dashboard.vercel.app',
  digestCallType: 'BREAKDOWN',
  introTextNormal: 'Please find enclosed daily MIS Report.',
  introTextRevised: 'Please find the revised report for Daily MIS Report.',
  allowedEmailDomains: [...DEFAULT_ALLOWED_EMAIL_DOMAINS],
  outboundMailEnabled: true,
  majorRepairMinCount: 3,
  majorRepairMonths: 3,
  majorRepairDefaultTo: 'sunil.sawant@westernequipments.com',
  majorRepairDefaultCc: 'vishnu.vishwakarma@westernequipments.com',
  watchdogToEmail: DEFAULT_WATCHDOG_TO_EMAIL,
  watchdogSubjectTemplate: DEFAULT_WATCHDOG_SUBJECT_TEMPLATE,
  watchdogBodyTemplate: DEFAULT_WATCHDOG_BODY_TEMPLATE,
};

export const MIS_EMAIL_ORG_SETTINGS_KEY = 'mis_email';

/** Org letter branding used by compose + Profile composer preview. */
export type MisEmailLetterCopy = {
  subjectTemplate: string;
  subjectTemplateRevised: string;
  introTextNormal: string;
  introTextRevised: string;
  greeting: string;
  brandTitle: string;
  brandSubtitle: string;
  portalBaseUrl: string;
};

export function toMisEmailLetterCopy(org: MisEmailOrgSettings): MisEmailLetterCopy {
  return {
    subjectTemplate: org.subjectTemplate,
    subjectTemplateRevised: org.subjectTemplateRevised,
    introTextNormal: org.introTextNormal,
    introTextRevised: org.introTextRevised,
    greeting: org.greeting,
    brandTitle: org.brandTitle,
    brandSubtitle: org.brandSubtitle,
    portalBaseUrl: org.portalBaseUrl,
  };
}
