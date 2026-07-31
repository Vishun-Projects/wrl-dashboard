import { describe, expect, it } from 'vitest';
import {
  appendRegisterListFilters,
  emptyRegisterViewFilterParts,
  isBaseRegisterPersistFilter,
} from '@/modules/mis/services/filters';

const clear = emptyRegisterViewFilterParts({
  selectedCallTypes: [],
  selectedOfficeIds: [],
});

describe('register list URL / persist helpers', () => {
  it('appendRegisterListFilters encodes filters and disables filter-options fetch', () => {
    const url = appendRegisterListFilters('/api/report?page=1', {
      searchForUrl: 'abc',
      startDateStr: '2026-01-01',
      endDateStr: '2026-01-31',
      dateFilterColumn: 'dtrndate',
      selectedState: ['MH'],
      selectedCity: [],
      selectedRegion: [],
      selectedAccount: [],
      selectedBranch: ['10'],
      selectedFranchisee: [],
      selectedTechnician: [],
      selectedStatus: [],
      priorityFilter: [],
      portalFilter: [],
      repairFilter: ['motor'],
    });
    expect(url).toContain('search=abc');
    expect(url).toContain('startDate=2026-01-01');
    expect(url).toContain('branch=10');
    expect(url).toContain('repair=motor');
    expect(url).toContain('fetchFilterOptions=false');
  });

  it('isBaseRegisterPersistFilter is true only when register + account chrome are clear', () => {
    expect(
      isBaseRegisterPersistFilter({
        ...clear,
        filterAccount: [],
        filterRegion: [],
      })
    ).toBe(true);
    expect(
      isBaseRegisterPersistFilter({
        ...clear,
        selectedBranch: ['1'],
        filterAccount: [],
        filterRegion: [],
      })
    ).toBe(false);
  });
});
