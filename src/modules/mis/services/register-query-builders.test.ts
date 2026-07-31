import { describe, expect, it } from 'vitest';
import {
  buildRegisterExportQueryFromViewFilters,
  buildRegisterListQueryKeyFromViewFilters,
} from './register-query-builders';

const viewFilters = {
  search: 'abc',
  pincodeSearch: '560001',
  selectedState: ['KA'],
  selectedCity: ['BLR'],
  selectedRegion: ['South'],
  selectedAccount: ['A1'],
  selectedBranch: ['101'],
  selectedFranchisee: ['201'],
  selectedTechnician: ['T1'],
  selectedStatus: ['Open Unallocated'],
  priorityFilter: ['major'],
  portalFilter: ['verified'],
  repairFilter: ['major'],
};

describe('register-query-builders', () => {
  it('builds register list query key from shared view filters', () => {
    const key = buildRegisterListQueryKeyFromViewFilters({
      officeIdsParam: 'All',
      callTypesParam: 'Breakdown',
      startDateStr: '2026-07-01',
      endDateStr: '2026-07-31',
      dateFilterColumn: 'dtrndate',
      agingAsOf: '',
      pageLimit: 25,
      viewFilters,
    });

    expect(key).toContain('Breakdown');
    expect(key).toContain('560001');
    expect(key).toContain('dtrndate');
  });

  it('builds export query payload from shared view filters', () => {
    const query = buildRegisterExportQueryFromViewFilters({
      officeId: 'All',
      callType: 'Breakdown',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      dateFilterColumn: 'dtrndate',
      viewFilters,
    });

    expect(query.callType).toBe('Breakdown');
    expect(query.search).toBe('abc');
    expect(query.pincode).toBe('560001');
    expect(query.branch).toBe('101');
  });
});
