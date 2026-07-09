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
import { buildMisEmailRegionalPerformanceRows } from '@/lib/mis-email/mail-basis';

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

function regionalBodyContext(summary: SummaryDashboard = sampleData): MisEmailBodyContext {
  return {
    summary,
    regionalPerformanceRows: buildMisEmailRegionalPerformanceRows(summary, []),
  };
}

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
    const html = buildEmailBodySectionsHtml(['regional_performance'], regionalBodyContext());
    expect(html).toContain('Regional Performance');
    expect(html).toContain('NORTH');
    expect(html).toContain('EAST');
    expect(html).toContain('All');
    expect(html).toContain('Part pending');
    expect(html).not.toContain('>Cancelled<');
    expect(html).not.toContain('Cancelled</th>');
    // Total = solved + open (exclude cancelled): Delhi 90+8=98
    expect(html).toContain('>98<');
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
    // Total = solved + open = 45 + 4
    expect(html).toContain('>49<');
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

  it('sorts key account rows by zone then account name', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: ['Subway', 'Starbucks'],
      accountRows: [
        { region: 'WEST ZONE', account: 'Subway', total_calls: 1, total_solved: 0, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'EAST ZONE', account: 'Starbucks', total_calls: 2, total_solved: 1, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'EAST ZONE', account: 'Subway', total_calls: 3, total_solved: 2, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'NORTH ZONE', account: 'Starbucks', total_calls: 4, total_solved: 3, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
      ],
    };
    const html = buildEmailBodySectionsHtml(['key_account_performance'], context);
    const eastStarbucks = html.indexOf('EAST</td>');
    const eastSubway = html.indexOf('EAST', eastStarbucks + 1);
    const northStarbucks = html.indexOf('NORTH</td>');
    const westSubway = html.indexOf('WEST</td>');
    expect(eastStarbucks).toBeGreaterThan(-1);
    expect(eastSubway).toBeGreaterThan(eastStarbucks);
    expect(northStarbucks).toBeGreaterThan(eastSubway);
    expect(westSubway).toBeGreaterThan(northStarbucks);
    expect(html.indexOf('Starbucks', eastStarbucks)).toBeLessThan(html.indexOf('Subway', eastStarbucks + 1));
  });

  it('merges key-account region cells in legacy grid layout', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: ['Subway', 'Starbucks'],
      accountRows: [
        { region: 'EAST ZONE', account: 'Starbucks', total_calls: 2, total_solved: 1, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'EAST ZONE', account: 'Subway', total_calls: 3, total_solved: 2, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'NORTH ZONE', account: 'Starbucks', total_calls: 4, total_solved: 3, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
      ],
    };
    const html = buildEmailBodySectionsHtml(
      ['key_account_performance'],
      context,
      {
        mode: 'grid',
        columns: 2,
        mergeKeyAccountRegions: true,
        placements: [{ sectionId: 'key_account_performance', col: 1, row: 1 }],
      }
    );
    expect(html).toContain('rowspan="2"');
    const eastCount = (html.match(/EAST<\/td>/g) ?? []).length;
    expect(eastCount).toBe(1);
  });

  it('truncates key account rows when maxRows is set', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: [],
      accountRows: [
        { region: 'EAST ZONE', account: 'A', total_calls: 1, total_solved: 0, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'NORTH ZONE', account: 'B', total_calls: 2, total_solved: 1, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
      ],
    };
    const html = buildEmailBodySectionsHtml(['key_account_performance'], context, {
      keyAccountMaxRows: 1,
    });
    expect(html).toContain('Showing 1 of 2');
    expect(html).toContain('Gmail limits');
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
    const text = buildEmailBodySectionsPlainText(['regional_performance'], regionalBodyContext());
    expect(text).toContain('Regional Performance');
    expect(text).toContain('NORTH');
    expect(text).toContain('All');
    expect(text).not.toContain('cancelled');
    expect(text).toContain('total 98');
  });
});
