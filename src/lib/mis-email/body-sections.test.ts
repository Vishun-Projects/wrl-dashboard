import { describe, expect, it } from 'vitest';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  parseMisEmailBodySectionIds,
  resolveEffectiveBodySections,
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
  accountSummary: [],
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
      resolveEffectiveBodySections(false, {
        bodyInEmail: ['regional_performance'],
      })
    ).toEqual([]);
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
});

describe('buildEmailBodySectionsPlainText', () => {
  it('includes regional lines', () => {
    const text = buildEmailBodySectionsPlainText(['regional_performance'], sampleData);
    expect(text).toContain('Regional Performance');
    expect(text).toContain('NORTH');
    expect(text).toContain('All');
  });
});
