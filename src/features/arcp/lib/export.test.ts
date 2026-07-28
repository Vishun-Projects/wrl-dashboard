import { describe, expect, it } from 'vitest';
import { buildArcpClaimsCsv } from '@/features/arcp/lib/export';
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
