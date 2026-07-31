import { describe, expect, it } from 'vitest';
import { mergeRegisterDeltaRecords } from '@/features/report/services/register-delta';
import type { RegisterSummary } from '@/features/report/services/search';

const emptyFilters = {
  search: '',
  pincodeSearch: '',
  selectedState: [] as string[],
  selectedCity: [] as string[],
  selectedRegion: [] as string[],
  selectedAccount: [] as string[],
  selectedBranch: [] as string[],
  selectedFranchisee: [] as string[],
  selectedTechnician: [] as string[],
  selectedCallTypes: [] as string[],
  selectedOfficeIds: [] as string[],
  selectedStatus: [] as string[],
  priorityFilter: [] as string[],
  portalFilter: [] as string[],
  repairFilter: [] as string[],
};

describe('mergeRegisterDeltaRecords', () => {
  it('bumps branch/account/register summary when an open row closes', () => {
    const summary: RegisterSummary = {
      total: 1,
      cancelled: 0,
      open: 1,
      openUnallocated: 1,
      assigned: 0,
      solved: 0,
      techSolved: 0,
      closed: 0,
    };
    const existing = {
      UniqueCallNo: 'A1',
      vcclid: '1',
      callsdtrndate: '2026-01-02',
      officename: 'West',
      nofficeid: 10,
      PartyName: 'Acme',
    };
    const updated = {
      ...existing,
      Status: 'Closed',
      callsolved: 'True',
    };

    const result = mergeRegisterDeltaRecords({
      currentData: [existing],
      currentTotal: 1,
      currentRegisterSummary: summary,
      currentSummaryData: [
        { officeId: 10, branch: 'West', solved_calls: 0, cancelled_calls: 0, open_calls: 1 },
      ],
      currentAccountsData: [{ account: 'Acme', total_solved: 0, cancelled_calls: 0, open_calls: 1 }],
      newRecords: [updated],
      filterCtx: emptyFilters,
    });

    expect(result.kind).toBe('full');
    if (result.kind !== 'full') return;
    expect(result.nextSummaryData[0].solved_calls).toBe(1);
    expect(result.nextSummaryData[0].open_calls).toBe(0);
    expect(result.nextAccountsData[0].total_solved).toBe(1);
    expect(result.nextSummary?.solved).toBe(1);
  });
});
