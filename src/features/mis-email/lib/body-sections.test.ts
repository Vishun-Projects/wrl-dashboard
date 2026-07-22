import { describe, expect, it } from 'vitest';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  parseMisEmailBodySectionIds,
  resolveAvailableBodySections,
  resolveDigestBodySections,
  resolveEffectiveBodySections,
  type MisEmailBodyContext,
} from '@/features/mis-email/lib/body-sections';
import type { SummaryDashboard } from '@/features/report';
import { buildMisEmailRegionalPerformanceRows } from '@/features/mis-email/lib/mail-basis';

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
    expect(html).toContain('&lt;2 days');
    expect(html).toContain('&gt;3 days');
    expect(html).toContain('&gt;7 days');
    expect(html).toContain('&gt;15days');
    expect(html).toContain('# of active Eng.');
    expect(html).not.toContain('Part pending');
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
    expect(html).toContain('&gt;3 days');
    expect(html).toContain('&gt;7 days');
    expect(html).toContain('&gt;15days');
    expect(html).toContain('% &gt;7 days');
    expect(html).not.toContain('# of active Eng.');
    expect(html).not.toContain('Part pending');
  });

  it('displays Cadbury as Mondelez and Coke as HCCB in key account body', () => {
    const html = buildEmailBodySectionsHtml(['key_account_performance'], {
      summary: sampleData,
      accountRows: [
        {
          region: 'NORTH ZONE',
          account: 'CADBURY',
          total_calls: 10,
          total_solved: 8,
          open_calls: 2,
          age_2: 1,
          age_3: 0,
          age_7: 1,
          age_15: 0,
          active_eng: 1,
        },
        {
          region: 'SOUTH ZONE',
          account: 'COKE',
          total_calls: 20,
          total_solved: 15,
          open_calls: 5,
          age_2: 2,
          age_3: 1,
          age_7: 1,
          age_15: 1,
          active_eng: 2,
        },
      ],
    });
    expect(html).toContain('Mondelez');
    expect(html).toContain('HCCB');
    expect(html).not.toContain('>CADBURY<');
    expect(html).not.toContain('>COKE<');
  });

  it('applies inline >15 day color bands for email clients', () => {
    const highAgingSummary: SummaryDashboard = {
      ...sampleData,
      branchSummary: [
        {
          ...sampleData.branchSummary[0],
          region: 'SOUTH ZONE',
          age_15: 95,
          solved_calls: 50,
          open_calls: 120,
          total_calls: 170,
        },
      ],
    };
    const html = buildEmailBodySectionsHtml(['branch_performance'], {
      summary: highAgingSummary,
    });
    expect(html).toContain('Branches');
    expect(html).toContain('bgcolor="#fecaca"');
    expect(html).toContain('color:#111827');
  });

  it('keeps %>7 alert bands on key accounts but does not color >15days cells', () => {
    const html = buildEmailBodySectionsHtml(['key_account_performance'], {
      summary: sampleData,
      accountRows: [
        {
          region: 'NORTH ZONE',
          account: 'Demo Account',
          total_calls: 120,
          total_solved: 80,
          open_calls: 40,
          age_2: 10,
          age_3: 10,
          age_7: 10,
          age_15: 10,
          active_eng: 5,
        },
      ],
    });

    expect(html).toContain('bgcolor="#fee2e2"');
    expect(html).toContain('color:#991b1b');
    expect(html).not.toContain('bgcolor="#bbf7d0"');
    expect(html).not.toContain('bgcolor="#fde68a"');
    expect(html).not.toContain('bgcolor="#dcfce7"');
    expect(html).toContain('color:#065f46');
  });

  it('colors only the label column with zone bands in branch performance', () => {
    const html = buildEmailBodySectionsHtml(['branch_performance'], {
      summary: sampleData,
    });
    expect(html).toContain('bgcolor="#e7f3de"');
    expect(html).not.toMatch(/mis-td mis-open" bgcolor="#e7f3de"/);
  });

  it('omits branch rows that are all zeros', () => {
    const summary: SummaryDashboard = {
      ...sampleData,
      branchSummary: [
        sampleData.branchSummary[0],
        {
          ...sampleData.branchSummary[0],
          officeId: 99,
          branch: 'AGRA BRANCH - 1160',
          region: 'NORTH ZONE',
          total_calls: 0,
          solved_calls: 0,
          cancelled_calls: 0,
          open_calls: 0,
          age_2: 0,
          age_3: 0,
          age_7: 0,
          age_15: 0,
          part_pending: 0,
          active_eng: 0,
          all_total: 0,
          all_solved: 0,
          all_cancelled: 0,
          all_open: 0,
          all_age_2: 0,
          all_age_3: 0,
          all_age_7: 0,
          all_age_15: 0,
          all_part_pending: 0,
        },
      ],
    };
    const html = buildEmailBodySectionsHtml(['branch_performance'], { summary });
    expect(html).toContain('Delhi');
    expect(html).not.toContain('AGRA BRANCH - 1160');
  });

  it('sorts key account rows NORTH → EAST → WEST → SOUTH, then account name', () => {
    const context: MisEmailBodyContext = {
      summary: sampleData,
      keyAccountsInBody: ['Subway', 'Starbucks'],
      accountRows: [
        { region: 'WEST ZONE', account: 'Subway', total_calls: 1, total_solved: 0, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'EAST ZONE', account: 'Starbucks', total_calls: 2, total_solved: 1, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'EAST ZONE', account: 'Subway', total_calls: 3, total_solved: 2, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'SOUTH ZONE', account: 'Subway', total_calls: 5, total_solved: 4, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
        { region: 'NORTH ZONE', account: 'Starbucks', total_calls: 4, total_solved: 3, open_calls: 1, age_2: 0, age_3: 0, age_7: 0, age_15: 0, active_eng: 0 },
      ],
    };
    const html = buildEmailBodySectionsHtml(['key_account_performance'], context);
    const northStarbucks = html.indexOf('NORTH</td>');
    const eastStarbucks = html.indexOf('EAST</td>');
    const eastSubway = html.indexOf('EAST', eastStarbucks + 1);
    const westSubway = html.indexOf('WEST</td>');
    const southSubway = html.indexOf('SOUTH</td>');
    expect(northStarbucks).toBeGreaterThan(-1);
    expect(eastStarbucks).toBeGreaterThan(northStarbucks);
    expect(eastSubway).toBeGreaterThan(eastStarbucks);
    expect(westSubway).toBeGreaterThan(eastSubway);
    expect(southSubway).toBeGreaterThan(westSubway);
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
    expect(html).toContain('colspan="10"');
    expect(html).toContain('attached Key Account MIS Excel');
    expect(html).not.toContain('Gmail limits');
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
