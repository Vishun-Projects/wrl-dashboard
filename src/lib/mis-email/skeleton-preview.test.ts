import { describe, expect, it } from 'vitest';
import { buildMisEmailSkeletonPreview } from '@/lib/mis-email/skeleton-preview';

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
    expect(preview?.subject).toMatch(/^WRL MIS Reports — \d{4}-\d{2}-\d{2}$/);
    expect(preview?.attachments).toHaveLength(3);
    expect(preview?.html).toContain('Regional Performance');
    expect(preview?.html).toContain('Branch-wise Performance');
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
});
