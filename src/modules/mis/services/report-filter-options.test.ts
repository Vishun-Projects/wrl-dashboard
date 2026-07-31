import { describe, expect, it } from 'vitest';
import { buildReportFilterOptions, deriveCascadeFilterLists } from './report-filter-options';

describe('buildReportFilterOptions', () => {
  it('maps filter sources into value/label option arrays', () => {
    const options = buildReportFilterOptions({
      callTypes: ['Breakdown'],
      statesList: [{ vname: 'KA' }],
      citiesList: [{ ncode: '560001', vname: 'BLR' }],
      regionsList: [{ vname: 'South' }],
      accountsList: [{ vname: 'A1' }],
      techniciansList: [{ ncode: 'T1', vname: 'Tech 1' }],
    });

    expect(options.callTypeOptions).toEqual([{ value: 'Breakdown', label: 'Breakdown' }]);
    expect(options.stateOptions).toEqual([{ value: 'KA', label: 'KA' }]);
    expect(options.cityOptions).toEqual([{ value: '560001', label: 'BLR' }]);
    expect(options.technicianOptions).toEqual([{ value: 'T1', label: 'Tech 1' }]);
  });
});

describe('deriveCascadeFilterLists', () => {
  it('derives sorted cascade lists from calls', () => {
    const derived = deriveCascadeFilterLists(
      [
        {
          state: 'KA',
          city: 'BLR',
          region: 'South',
          account: 'A1',
          nengineer: '10',
          technician_name: 'Tech',
          resolved_branch_code: '101',
          officename: '101 - BRANCH',
          franchisee_code: 'F1',
          franchisee_name: 'Fr 1',
        },
      ],
      {
        state: [],
        city: [],
        region: [],
        account: [],
        selectedBranch: [],
        selectedFranchisee: [],
        technician: [],
        pincodeSearch: '',
      }
    );

    expect(derived.statesList[0]?.vname).toBe('KA');
    expect(derived.citiesList[0]?.vname).toBe('BLR');
    expect(derived.techniciansList[0]?.ncode).toBe('10');
    expect(derived.branchesList[0]?.ncode).toBe('101');
    expect(derived.franchiseesList[0]?.ncode).toBe('F1');
  });
});
