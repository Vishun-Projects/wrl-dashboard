import { describe, expect, it } from 'vitest';
import {
  aggregateYtdExportSummary,
  buildNightlyYtdExportEmailHtml,
  buildNightlyYtdExportEmailText,
} from '@/modules/mis-email/services/nightly-ytd-export';

describe('nightly-ytd-export', () => {
  it('aggregates branch summary into totals', () => {
    const summary = aggregateYtdExportSummary(
      {
        branchSummary: [
          {
            officeId: 1,
            parentId: 0,
            branch: 'A',
            region: 'NORTH',
            total_calls: 100,
            solved_calls: 60,
            cancelled_calls: 10,
            open_calls: 25,
            tech_solved_calls: 5,
            age_2: 0,
            age_3: 0,
            age_7: 0,
            age_15: 0,
            part_pending: 0,
            all_total: 100,
            all_solved: 60,
            all_cancelled: 10,
            all_open: 25,
            all_age_2: 0,
            all_age_3: 0,
            all_age_7: 0,
            all_age_15: 0,
            all_part_pending: 0,
            all_tech_solved: 5,
            deployment_total: 0,
            deployment_done: 0,
            installation_total: 0,
            installation_done: 0,
            active_eng: 0,
            population: 100,
            headcount: 0,
          },
          {
            officeId: 2,
            parentId: 0,
            branch: 'B',
            region: 'WEST',
            total_calls: 50,
            solved_calls: 30,
            cancelled_calls: 5,
            open_calls: 12,
            tech_solved_calls: 3,
            age_2: 0,
            age_3: 0,
            age_7: 0,
            age_15: 0,
            part_pending: 0,
            all_total: 50,
            all_solved: 30,
            all_cancelled: 5,
            all_open: 12,
            all_age_2: 0,
            all_age_3: 0,
            all_age_7: 0,
            all_age_15: 0,
            all_part_pending: 0,
            all_tech_solved: 3,
            deployment_total: 0,
            deployment_done: 0,
            installation_total: 0,
            installation_done: 0,
            active_eng: 0,
            population: 50,
            headcount: 0,
          },
        ],
        accountSummary: [],
        globalHeadcount: 0,
      },
      150
    );

    expect(summary).toEqual({
      total: 150,
      closed: 90,
      open: 37,
      cancelled: 15,
      techSolved: 8,
      exportRows: 150,
    });
  });

  it('includes summary counts in email body', () => {
    const dateRange = {
      startDate: '2026-01-01',
      endDate: '2026-08-24',
      label: 'Year to yesterday (24 Aug 2026)',
    };
    const summary = {
      total: 1000,
      closed: 700,
      open: 200,
      cancelled: 100,
      techSolved: 50,
      exportRows: 1000,
    };
    const html = buildNightlyYtdExportEmailHtml({
      dateRange,
      callType: 'BREAKDOWN',
      summary,
      generatedAtIst: '25 Aug 2026, 12:00 am',
    });
    const text = buildNightlyYtdExportEmailText({
      dateRange,
      callType: 'BREAKDOWN',
      summary,
      generatedAtIst: '25 Aug 2026, 12:00 am',
    });

    expect(html).toContain('Closed / solved');
    expect(html).toContain('1,000');
    expect(text).toContain('Cancelled: 100');
    expect(text).toContain('2026-01-01');
  });
});
