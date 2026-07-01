import { describe, expect, it } from 'vitest';
import {
  MIS_EMAIL_THEME,
  buildDigestEmailHtml,
  formatRecipientGreeting,
  formatReportPeriod,
} from '@/lib/mis-email/email-template';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';

const sampleRange: DigestDateRange = {
  startDate: '2026-07-01',
  endDate: '2026-07-01',
  label: 'This Month',
};

describe('formatRecipientGreeting', () => {
  it('uses first name for normal names', () => {
    expect(formatRecipientGreeting('Vishnu Vishwakarma')).toBe('Dear Vishnu,');
  });

  it('falls back for gibberish test names', () => {
    expect(formatRecipientGreeting('aaaaaasdfghjk')).toBe('Dear Colleague,');
    expect(formatRecipientGreeting('asdfghjk')).toBe('Dear Colleague,');
  });

  it('falls back to email local-part when name is gibberish', () => {
    expect(formatRecipientGreeting('aaaaaasdfghjk', 'vishnu@wrl.com')).toBe('Dear Vishnu,');
    expect(
      formatRecipientGreeting('aaaaaasdfghjk', 'vishnu.vishwakarma@westernequipments.com')
    ).toBe('Dear Vishnu,');
  });

  it('rejects username handles copied from email local-part', () => {
    expect(
      formatRecipientGreeting('vishunvishwakarma90211', 'vishunvishwakarma90211@gmail.com')
    ).toBe('Dear Colleague,');
    expect(formatRecipientGreeting('Vishnu Vishwakarma', 'vishunvishwakarma90211@gmail.com')).toBe(
      'Dear Vishnu,'
    );
  });
});

describe('formatReportPeriod', () => {
  it('formats end date as month and year', () => {
    expect(formatReportPeriod(sampleRange)).toBe('July 2026');
  });
});

describe('buildDigestEmailHtml', () => {
  const html = buildDigestEmailHtml({
    recipientName: 'Vishnu Vishwakarma',
    recipientEmail: 'vishnu@wrl.com',
    dateRange: sampleRange,
    scopeLabel: 'All branches',
    portalUrl: 'https://wrl-dashboard.vercel.app',
  });

  it('uses professional layout with left stripe and meta grid', () => {
    expect(html).toContain('class="email-stripe"');
    expect(html).toContain('WESTERN REFRIGERATION');
    expect(html).toContain('Report period');
    expect(html).toContain('Branch scope');
    expect(html).toContain('Open WRL Dashboard');
    expect(html).not.toContain('v:roundrect');
  });

  it('forces light rendering for Outlook dark mode', () => {
    expect(html).toContain('color-scheme" content="light"');
    expect(html).toContain('[data-ogsc] .email-card');
  });

  it('uses text link CTA without filled button', () => {
    expect(html).toContain('class="email-link"');
    expect(html).not.toContain('cta-button');
  });

  it('includes greeting, period, and scope', () => {
    expect(html).toContain('Dear Vishnu,');
    expect(html).toContain('July 2026');
    expect(html).toContain('All branches');
    expect(html).toContain('href="https://wrl-dashboard.vercel.app/report"');
  });
});
