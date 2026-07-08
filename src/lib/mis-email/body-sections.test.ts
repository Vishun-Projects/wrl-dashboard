import { describe, expect, it } from 'vitest';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  parseMisEmailBodySectionIds,
  resolveAvailableBodySections,
  resolveDigestBodySections,
  resolveEffectiveBodySections,
  type MisEmailBodyContext,
} from '@/lib/mis-email/body-sections';
import type { SummaryDashboard } from '@/lib/report/summary-derive';

const sampleData: SummaryDashboard = {
  globalHeadcount: 10,
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
      age_15: 0,
      part_pending: 1,
      all_total: 100,
      all_solved: 90,
      all_cancelled: 2,
      all_open: 8,
      all_age_2: 5,
      all_age_3: 2,
      all_age_7: 1,
      all_age_15: 0,
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
    {
      officeId: 2,
      parentId: 0,
      branch: 'Kolkata',
      region: 'EAST ZONE',
      total_calls: 200,
      solved_calls: 180,
      cancelled_calls: 1,
      open_calls: 19,
      age_2: 10,
      age_3: 5,
      age_7: 3,
      age_15: 1,
      part_pending: 0,
      all_total: 200,
      all_solved: 180,
      all_cancelled: 1,
      all_open: 19,
      all_age_2: 10,
      all_age_3: 5,
      all_age_7: 3,
      all_age_15: 1,
      all_part_pending: 0,
      all_tech_solved: 0,
      tech_solved_calls: 0,
      deployment_total: 0,
      deployment_done: 0,
      installation_total: 0,
      installation_done: 0,
      active_eng: 20,
      population: 200,
      headcount: 5,
    },
  ],
  accountSummary: [
    {
      region: 'NORTH ZONE',
      account: 'Nestle',
      population: 10,
      total_calls: 50,
      total_solved: 45,
      cancelled_calls: 1,
      open_calls: 4,
      age_2: 2,
      age_3: 1,
      age_7: 1,
      age_15: 0,
      part_pending: 0,
      deployment_total: 0,
      deployment_done: 0,
      installation_total: 0,
      installation_done: 0,
      active_eng: 3,
      headcount: 2,
      total_tech_solved: 0,
    },
  ],
};

describe('parseMisEmailBodySectionIds', () => {
  it('keeps known ids in order and dedupes', () => {
    expect(
      parseMisEmailBodySectionIds([
        'regional_performance',
        'unknown',
        'branch_performance',
        'regional_performance',
      ])
    ).toEqual(['regional_performance', 'branch_performance']);
  });
});

describe('resolveEffectiveBodySections', () => {
  it('returns empty when summary is not permitted', () => {
    expect(
      resolveEffectiveBodySections(
        { includeSummary: false, includeKeyAccount: false },
        { bodyInEmail: ['regional_performance'] }
      )
    ).toEqual([]);
  });

  it('allows key account section when key account permission is granted', () => {
    expect(
      resolveEffectiveBodySections(
        { includeSummary: false, includeKeyAccount: true },
        { bodyInEmail: ['key_account_performance'] }
      )
    ).toEqual(['key_account_performance']);
  });
});

describe('resolveAvailableBodySections', () => {
  it('includes key account section only with key account permission', () => {
    const sections = resolveAvailableBodySections({
      includeSummary: true,
      includeKeyAccount: true,
    });
    expect(sections.map((s) => s.id)).toContain('key_account_performance');
  });
});

describe('resolveDigestBodySections', () => {
  it('auto-includes key account when attachment is enabled', () => {
    expect(
      resolveDigestBodySections(
        { includeSummary: true, includeKeyAccount: true },
        { bodyInEmail: ['regional_performance', 'branch_performance'] },
        { includeKeyAccountAttachment: true }
      )
    ).toEqual(['regional_performance', 'branch_performance', 'key_account_performance']);
  });
});

describe('buildEmailBodySectionsHtml', () => {
  it('renders regional performance with grand total', () => {
    const html = buildEmailBodySectionsHtml(['regional_performance'], sampleData);
    expect(html).toContain('Regional Performance');
    expect(html).toContain('NORTH');
    expect(html).toContain('EAST');
    expect(html).toContain('All');
    expect(html).toContain('Part pending');
  });

  it('renders key account breakdown for selected accounts', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: ['Nestle'],
      accountRows: [
        {
          region: 'NORTH ZONE',
          account: 'Nestle',
          total_calls: 50,
          total_solved: 45,
          open_calls: 4,
          age_2: 2,
          age_3: 1,
          age_7: 1,
          age_15: 0,
          active_eng: 3,
        },
      ],
    };
    const html = buildEmailBodySectionsHtml(['key_account_performance'], context);
    expect(html).toContain('Key Account Breakdown');
    expect(html).toContain('Nestle');
    expect(html).toContain('% &gt;7 days');
  });

  it('renders key account rows when accountRows are provided', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: [],
      accountRows: [
        {
          region: 'NORTH ZONE',
          account: 'Nestle',
          total_calls: 50,
          total_solved: 45,
          open_calls: 4,
          age_2: 2,
          age_3: 1,
          age_7: 1,
          age_15: 0,
          active_eng: 3,
        },
      ],
    };
    const html = buildEmailBodySectionsHtml(['key_account_performance'], context);
    expect(html).toContain('Nestle');
  });

  it('renders nothing for key account section when no account rows', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: [],
      accountRows: [],
    };
    const html = buildEmailBodySectionsHtml(['key_account_performance'], context);
    expect(html).toBe('');
  });
});

describe('buildEmailBodySectionsPlainText', () => {
  it('includes regional lines', () => {
    const text = buildEmailBodySectionsPlainText(['regional_performance'], sampleData);
    expect(text).toContain('Regional Performance');
    expect(text).toContain('NORTH');
    expect(text).toContain('All');
  });
});
