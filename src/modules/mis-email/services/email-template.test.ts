import { describe, expect, it } from 'vitest';
import { buildEmailBodySectionsHtml } from '@/modules/mis-email/services/body-sections';
import {
  buildDigestEmailHtml,
  buildDigestEmailPlainText,
  formatRecipientGreeting,
  formatReportPeriod,
  MIS_EMAIL_INTRO_BY_PRESET,
  resolveMisEmailIntroText,
} from '@/modules/mis-email/services/email-template';
import type { DigestDateRange } from '@/modules/mis-email/services/fetch-digest-data';
import type { SummaryDashboard } from '@/modules/mis';

const sampleRange: DigestDateRange = {
  startDate: '2026-07-01',
  endDate: '2026-07-01',
  label: 'This Month',
};

describe('formatRecipientGreeting', () => {
  it('uses fixed Zonal Heads greeting', () => {
    expect(formatRecipientGreeting('Vishnu Vishwakarma')).toBe('Dear Zonal Heads,');
    expect(formatRecipientGreeting('aaaaaasdfghjk')).toBe('Dear Zonal Heads,');
    expect(formatRecipientGreeting('anyone', 'vishnu@wrl.com')).toBe('Dear Zonal Heads,');
  });
});

describe('formatReportPeriod', () => {
  it('formats end date as month and year', () => {
    expect(formatReportPeriod(sampleRange)).toBe('July 2026');
  });
});

describe('formatDigestSubject', () => {
  it('formats as Daily MIS Report as on DD-MM-YYYY', async () => {
    const { formatDigestSubject } = await import('@/modules/mis-email/services/email-template');
    expect(formatDigestSubject('2026-07-03')).toBe('Daily MIS Report as on 03-07-2026');
  });

  it('applies org subject template with {asOn}', async () => {
    const { formatDigestSubject } = await import('@/modules/mis-email/services/email-template');
    expect(formatDigestSubject('2026-07-03', undefined, 'MIS {asOn}')).toBe('MIS 03-07-2026');
  });

  it('uses separate normal vs revised subject templates', async () => {
    const { formatDigestSubject, resolveMisEmailSubjectTemplate } = await import(
      '@/modules/mis-email/services/email-template'
    );
    const normal = resolveMisEmailSubjectTemplate('normal');
    const revised = resolveMisEmailSubjectTemplate('revised');
    expect(formatDigestSubject('2026-07-03', undefined, normal)).toBe(
      'Daily MIS Report as on 03-07-2026'
    );
    expect(formatDigestSubject('2026-07-03', undefined, revised)).toBe(
      'Daily MIS Report as on 03-07-2026 (Revised)'
    );
    expect(
      formatDigestSubject(
        '2026-07-03',
        undefined,
        resolveMisEmailSubjectTemplate('revised', {
          normal: 'MIS {asOn}',
          revised: 'Revised pack {asOn}',
        })
      )
    ).toBe('Revised pack 03-07-2026');
  });
});

describe('resolveMisEmailIntroText', () => {
  it('defaults to normal and resolves revised', () => {
    expect(resolveMisEmailIntroText()).toBe(MIS_EMAIL_INTRO_BY_PRESET.normal);
    expect(resolveMisEmailIntroText('normal')).toBe(MIS_EMAIL_INTRO_BY_PRESET.normal);
    expect(resolveMisEmailIntroText('revised')).toBe(MIS_EMAIL_INTRO_BY_PRESET.revised);
  });

  it('prefers org intro texts when provided', () => {
    expect(
      resolveMisEmailIntroText('normal', {
        normal: 'Org normal intro.',
        revised: 'Org revised intro.',
      })
    ).toBe('Org normal intro.');
    expect(
      resolveMisEmailIntroText('revised', {
        normal: 'Org normal intro.',
        revised: 'Org revised intro.',
      })
    ).toBe('Org revised intro.');
  });

  it('falls back when org intro is blank', () => {
    expect(resolveMisEmailIntroText('normal', { normal: '  ', revised: 'x' })).toBe(
      MIS_EMAIL_INTRO_BY_PRESET.normal
    );
  });
});

describe('resolveMisEmailBrandSubtitle', () => {
  it('strips Revised for normal and adds it for revised', async () => {
    const { resolveMisEmailBrandSubtitle } = await import('@/modules/mis-email/services/email-template');
    expect(resolveMisEmailBrandSubtitle('WRL Dashboard (Revised)')).toBe('WRL Dashboard');
    expect(resolveMisEmailBrandSubtitle('WRL Dashboard (Revised)', 'normal')).toBe('WRL Dashboard');
    expect(resolveMisEmailBrandSubtitle('WRL Dashboard', 'revised')).toBe('WRL Dashboard (Revised)');
    expect(resolveMisEmailBrandSubtitle('WRL Dashboard (Revised)', 'revised')).toBe(
      'WRL Dashboard (Revised)'
    );
  });
});

describe('mergeMisEmailOrgSettings strips Revised from stored subtitle', () => {
  it('normalizes legacy WRL Dashboard (Revised)', async () => {
    const { mergeMisEmailOrgSettings } = await import('@/modules/mis-email/services/org-settings');
    expect(mergeMisEmailOrgSettings({ brandSubtitle: 'WRL Dashboard (Revised)' }).brandSubtitle).toBe(
      'WRL Dashboard'
    );
  });
});

describe('buildDigestEmailHtml', () => {
  const baseParams = {
    recipientName: 'Vishnu Vishwakarma',
    recipientEmail: 'vishnu@wrl.com',
    dateRange: sampleRange,
    scopeLabel: 'All branches',
    portalUrl: 'https://wrl-dashboard.vercel.app',
  };

  const html = buildDigestEmailHtml(baseParams);

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
    expect(html).toContain('Dear Zonal Heads,');
    expect(html).toContain(MIS_EMAIL_INTRO_BY_PRESET.normal);
    expect(html).toContain('July 2026');
    expect(html).toContain('All branches');
    expect(html).toContain('href="https://wrl-dashboard.vercel.app/report"');
  });

  it('uses revised intro when branding.introText is set', () => {
    const revised = buildDigestEmailHtml({
      ...baseParams,
      branding: { introText: MIS_EMAIL_INTRO_BY_PRESET.revised },
    });
    expect(revised).toContain(MIS_EMAIL_INTRO_BY_PRESET.revised);
    expect(revised).not.toContain(MIS_EMAIL_INTRO_BY_PRESET.normal);

    const plain = buildDigestEmailPlainText({
      ...baseParams,
      branding: { introText: MIS_EMAIL_INTRO_BY_PRESET.revised },
    });
    expect(plain).toContain(MIS_EMAIL_INTRO_BY_PRESET.revised);
    expect(plain).not.toContain(MIS_EMAIL_INTRO_BY_PRESET.normal);
  });

  it('preserves body table cell background colors when wrapping digest html', () => {
    const summary: SummaryDashboard = {
      branchSummary: [
        {
          officeId: 1,
          parentId: 0,
          branch: 'Delhi',
          region: 'NORTH ZONE',
          total_calls: 100,
          solved_calls: 90,
          cancelled_calls: 2,
          open_calls: 8,
          age_2: 5,
          age_3: 2,
          age_7: 1,
          age_15: 95,
          part_pending: 1,
          all_total: 100,
          all_solved: 90,
          all_cancelled: 2,
          all_open: 8,
          all_age_2: 5,
          all_age_3: 2,
          all_age_7: 1,
          all_age_15: 95,
          all_part_pending: 1,
          all_tech_solved: 0,
          tech_solved_calls: 0,
          deployment_total: 0,
          deployment_done: 0,
          installation_total: 0,
          installation_done: 0,
          active_eng: 12,
          population: 100,
          headcount: 5,
        },
      ],
      accountSummary: [],
      globalHeadcount: 5,
    };

    const bodyHtml = buildEmailBodySectionsHtml(['branch_performance'], { summary });
    const wrapped = buildDigestEmailHtml({
      recipientName: 'Vishnu',
      dateRange: sampleRange,
      scopeLabel: 'All branches',
      portalUrl: 'https://wrl-dashboard.vercel.app',
      bodyHtml,
    });

    expect(wrapped).toContain('bgcolor="#fecaca"');
    expect(wrapped).not.toContain('.mis-row td { background-color: transparent !important;');
  });
});
