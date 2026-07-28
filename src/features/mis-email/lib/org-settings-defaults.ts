import {
  DEFAULT_MIS_EMAIL_CC_EMAILS,
  DEFAULT_MIS_EMAIL_TO_EMAILS,
} from '@/features/mis-email/lib/default-recipients';
import type { MisEmailDateRangeMode } from '@/features/mis-email/lib/preferences';

/** Seed allowlist when DB empty / unset. */
export const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['westernequipments.com'] as const;

export type MisEmailOrgSettings = {
  defaultToEmails: string[];
  defaultCcEmails: string[];
  defaultSendTimeIst: string;
  defaultDateRange: MisEmailDateRangeMode;
  subjectTemplate: string;
  greeting: string;
  brandTitle: string;
  brandSubtitle: string;
  portalBaseUrl: string;
  digestCallType: string;
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
};

/** Fallbacks = today's hardcodes (empty DB → no silent prod change). */
export const MIS_EMAIL_ORG_SETTINGS_FALLBACKS: MisEmailOrgSettings = {
  defaultToEmails: [...DEFAULT_MIS_EMAIL_TO_EMAILS],
  defaultCcEmails: [...DEFAULT_MIS_EMAIL_CC_EMAILS],
  defaultSendTimeIst: '09:30',
  defaultDateRange: 'month_to_date',
  subjectTemplate: 'Daily MIS Report as on {asOn}',
  greeting: 'Dear Zonal Heads,',
  brandTitle: 'WESTERN REFRIGERATION',
  brandSubtitle: 'WRL Dashboard (Revised)',
  portalBaseUrl: 'https://wrl-dashboard.vercel.app',
  digestCallType: 'BREAKDOWN',
  allowedEmailDomains: [...DEFAULT_ALLOWED_EMAIL_DOMAINS],
  outboundMailEnabled: true,
  majorRepairMinCount: 3,
  majorRepairMonths: 3,
  majorRepairDefaultTo: 'sunil.sawant@westernequipments.com',
  majorRepairDefaultCc: 'vishnu.vishwakarma@westernequipments.com',
};

export const MIS_EMAIL_ORG_SETTINGS_KEY = 'mis_email';
