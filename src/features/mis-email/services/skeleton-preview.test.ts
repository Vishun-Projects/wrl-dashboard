import { describe, expect, it } from 'vitest';
import { buildMisEmailSkeletonPreview } from '@/features/mis-email/services/skeleton-preview';

const basePermissions = {
  includeSummary: true,
  includeDetailed: true,
  includeKeyAccount: true,
};

describe('buildMisEmailSkeletonPreview', () => {
  it('returns null when no attachments are selected', () => {
    expect(
      buildMisEmailSkeletonPreview({
        preferences: {
          includeSummary: false,
          includeDetailed: false,
          includeKeyAccount: false,
        },
        permissions: basePermissions,
        scopeLabel: 'All branches',
        recipientName: 'Test User',
        recipientEmail: 'test@example.com',
      })
    ).toBeNull();
  });

  it('empty prefs + summary permission yield non-null skeleton with default attachments', () => {
    const preview = buildMisEmailSkeletonPreview({
      preferences: {},
      permissions: basePermissions,
      scopeLabel: 'All branches',
      recipientName: 'Test User',
      recipientEmail: 'test@example.com',
    });
    expect(preview).not.toBeNull();
    expect(preview?.attachments.length).toBeGreaterThan(0);
    expect(preview?.attachments.some((name) => /summary/i.test(name))).toBe(true);
  });

  it('builds layout preview with skeleton tables for enabled body sections', () => {
    const preview = buildMisEmailSkeletonPreview({
      preferences: {
        dateRange: 'month_to_date',
        bodyInEmail: ['regional_performance', 'branch_performance'],
        keyAccountsInBody: ['Nestle'],
      },
      permissions: basePermissions,
      scopeLabel: 'HOD — All branches',
      recipientName: 'Vishnu',
      recipientEmail: 'vishnu@example.com',
      portalUrl: 'https://app.test',
    });

    expect(preview).not.toBeNull();
    expect(preview?.subject).toMatch(/^Daily MIS Report as on \d{2}-\d{2}-\d{4}$/);
    expect(preview?.attachments).toHaveLength(3);
    expect(preview?.html).toContain('Regional Performance');
    expect(preview?.html).toContain('Branch-wise Performance');
    expect(preview?.html).toContain('Branches');
    expect(preview?.html).toContain('>3 days');
    expect(preview?.html).toContain('>15days');
    expect(preview?.html).not.toContain('Part pending');
    expect(preview?.html).toContain('background-color:#cbd5e1');
    expect(preview?.html).toContain('bgcolor="#fecaca"');
    expect(preview?.html).not.toContain('bgcolor="#dcfce7"');
    expect(preview?.html).toContain('HOD — All branches');
  });

  it('does not auto-include key account section unless selected', () => {
    const preview = buildMisEmailSkeletonPreview({
      preferences: {
        bodyInEmail: ['regional_performance'],
      },
      permissions: basePermissions,
      scopeLabel: 'All branches',
      recipientName: 'User',
      recipientEmail: 'user@example.com',
    });

    expect(preview?.bodySectionIds).not.toContain('key_account_performance');
    expect(preview?.html).not.toContain('Key Account Breakdown');
  });

  it('uses org letterCopy revised subject (including custom dash)', () => {
    const preview = buildMisEmailSkeletonPreview({
      preferences: {
        dateRange: 'month_to_date',
        includeSummary: true,
      },
      permissions: basePermissions,
      scopeLabel: 'All branches',
      recipientName: 'User',
      recipientEmail: 'user@example.com',
      introPreset: 'revised',
      letterCopy: {
        subjectTemplate: 'Daily MIS Report as on {asOn}',
        subjectTemplateRevised: 'Daily MIS Report as on {asOn} - (Revised)',
        introTextNormal: 'Please find enclosed daily MIS Report.',
        introTextRevised: 'Please find the revised report for Daily MIS Report.',
        greeting: 'Dear Zonal Heads,',
        brandTitle: 'WESTERN REFRIGERATION',
        brandSubtitle: 'WRL Dashboard',
        portalBaseUrl: 'https://app.test',
      },
    });

    expect(preview).not.toBeNull();
    expect(preview?.subject).toMatch(/^Daily MIS Report as on \d{2}-\d{2}-\d{4} - \(Revised\)$/);
    expect(preview?.html).toContain('Please find the revised report for Daily MIS Report.');
    expect(preview?.html).toContain('Dear Zonal Heads,');
  });
});
