import { describe, expect, it } from 'vitest';
import {
  buildArcpClaimsCsv,
  buildArcpClaimsDetailCsv,
  buildArcpClaimsDetailCsvFileName,
} from '@/features/arcp/lib/export';
import type { ArcpClaimsTableModel } from '@/features/arcp/lib/table';

describe('buildArcpClaimsCsv', () => {
  it('emits header + total row for empty model', () => {
    const model: ArcpClaimsTableModel = {
      rows: [],
      totals: { qty: 0, amountPayable: 0, branchApproved: 0, hoApproved: 0 },
    };
    const csv = buildArcpClaimsCsv(model);
    const lines = csv.split(/\r?\n/);
    expect(lines[0]).toContain('Service Description');
    expect(lines[0]).toContain('Amount Payable');
    expect(lines[0]).toContain('Branch Approved');
    expect(lines[0]).toContain('HO Approved');
    expect(lines.at(-1)).toMatch(/^Total,/);
  });

  it('includes data rows between header and total', () => {
    const model: ArcpClaimsTableModel = {
      rows: [
        {
          kind: 'data',
          serviceDescriptionSubLabel: 'Labour',
          rate: 100,
          qty: 2,
          amountPayable: 200,
          branchApproved: 200,
          hoApproved: 180,
        },
      ],
      totals: { qty: 2, amountPayable: 200, branchApproved: 200, hoApproved: 180 },
    };
    const csv = buildArcpClaimsCsv(model);
    expect(csv).toContain('Labour');
    expect(csv).toContain('200');
    expect(csv).toContain('180');
  });
});

describe('ARCP detail export helpers', () => {
  it('builds the expected detail export filename', () => {
    expect(buildArcpClaimsDetailCsvFileName('2026-01-01', '2026-07-28')).toBe(
      'ARCP_Claims_Detail_2026-01-01_2026-07-28.csv'
    );
  });

  it('emits detail rows plus totals footer', () => {
    const csv = buildArcpClaimsDetailCsv(
      [
        {
          ncode: 1,
          vucnno: 'U1',
          branch_name: 'Delhi',
          franchisee_name: 'Dealer One',
          call_date: '2026-07-01',
          solve_date: '2026-07-02',
          bm_approved_date: '2026-07-03',
          call_type: 'BREAKDOWN',
          item_category: 'VISI COOLER',
          local_upcountry: 'Local',
          major_minor: 'Major',
          line_type: 'Labour',
          distance: 10,
          amount_payable: 1200,
          branch_approved: 1000,
          ho_approved: 900,
          raw_nchargespayable: 1200,
          raw_nbmapprovedamt: 1000,
          summary_section: 'BREAKDOWN',
          summary_sub_row: 'Local - Major',
          call_no: 'C1',
          calls2fault_code: 'F1',
          franchisee_code: 'FR1',
        } as never,
      ],
      { totals: { qty: 0, amountPayable: 1200, branchApproved: 1000, hoApproved: 900 } }
    );

    expect(csv).toContain('Serial No');
    expect(csv).toContain('U1');
    expect(csv).toContain('Dealer One');
    expect(csv).toContain('Totals row matches on-screen Service tally');
    expect(csv).toContain('Total');
  });
});
