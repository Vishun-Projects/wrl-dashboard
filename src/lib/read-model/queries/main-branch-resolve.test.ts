import { describe, expect, it } from 'vitest';
import { deriveSummaryDashboard } from '@/lib/summary/derive';
import {
  resolveMainBranchDisplayName,
  resolveMainBranchOfficeId,
} from '@/lib/read-model/queries/main-branch-resolve';

describe('main-branch-resolve', () => {
  it('maps franchisee office to parent branch id and name', () => {
    const row = {
      nofficeid: 900,
      office_under: 1164,
      office_name: 'IRFAN DTH',
      branch_name: '1164 - JAMMU BRANCH',
      resolved_branch_code: '1164',
      resolved_branch_name: '1164 - JAMMU BRANCH',
      region: 'NORTH ZONE',
      vtrnno: 'C1',
      calltype: 'BREAKDOWN',
      callsdtrndate: '2026-06-01',
    };

    expect(resolveMainBranchOfficeId(row)).toBe(1164);
    expect(resolveMainBranchDisplayName(row)).toBe('1164 - JAMMU BRANCH');
  });

  it('keeps main branch office on branch rows', () => {
    const row = {
      nofficeid: 1127,
      office_under: 0,
      office_name: '1127 - GUWAHATI BRANCH',
      branch_name: '1127 - GUWAHATI BRANCH',
      resolved_branch_code: '1127',
      resolved_branch_name: '1127 - GUWAHATI BRANCH',
      region: 'EAST ZONE',
      vtrnno: 'C2',
      calltype: 'BREAKDOWN',
      callsdtrndate: '2026-06-01',
    };

    expect(resolveMainBranchOfficeId(row)).toBe(1127);
    expect(resolveMainBranchDisplayName(row)).toBe('1127 - GUWAHATI BRANCH');
  });

  it('keeps WRL branch office under regional parent (does not roll up to SOUTH REGION)', () => {
    const row = {
      nofficeid: 18,
      office_under: 605,
      office_name: '1159 - CHENNAI BRANCH',
      branch_name: '1159 - CHENNAI BRANCH',
      resolved_branch_code: '18',
      resolved_branch_name: '1159 - CHENNAI BRANCH',
      region: 'SOUTH ZONE',
      vtrnno: 'C3',
      calltype: 'BREAKDOWN',
      callsdtrndate: '2026-06-01',
    };

    expect(resolveMainBranchOfficeId(row)).toBe(18);
    expect(resolveMainBranchDisplayName(row)).toBe('1159 - CHENNAI BRANCH');
  });
});

describe('deriveSummaryDashboard main-branch rollup', () => {
  it('aggregates franchisee calls under main branch name', () => {
    const calls = [
      {
        nofficeid: 828,
        office_under: 1164,
        office_name: 'GANGA REFRIGERATION',
        branch_name: '1164 - JAMMU BRANCH',
        resolved_branch_code: '1164',
        resolved_branch_name: '1164 - JAMMU BRANCH',
        region: 'NORTH ZONE',
        vtrnno: 'A1',
        calltype: 'BREAKDOWN',
        callsdtrndate: '2026-06-01',
        status_bucket: 'assigned',
      },
      {
        nofficeid: 900,
        office_under: 1164,
        office_name: 'IRFAN DTH',
        branch_name: '1164 - JAMMU BRANCH',
        resolved_branch_code: '1164',
        resolved_branch_name: '1164 - JAMMU BRANCH',
        region: 'NORTH ZONE',
        vtrnno: 'A2',
        calltype: 'BREAKDOWN',
        callsdtrndate: '2026-06-02',
        status_bucket: 'solved',
        bsolved: 1,
      },
    ];

    const { branchSummary } = deriveSummaryDashboard(calls, {
      agingAsOf: '2026-07-02',
    });

    expect(branchSummary).toHaveLength(1);
    expect(branchSummary[0]?.officeId).toBe(1164);
    expect(branchSummary[0]?.branch).toBe('1164 - JAMMU BRANCH');
    expect(branchSummary[0]?.total_calls).toBe(2);
    expect(branchSummary[0]?.solved_calls).toBe(1);
    expect(branchSummary[0]?.open_calls).toBe(1);
  });
});
