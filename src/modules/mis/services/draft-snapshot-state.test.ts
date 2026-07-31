import { describe, expect, it } from 'vitest';
import { toDateString } from '@/modules/mis/services/filters';
import {
  buildClearedDraftSnapshotFromState,
  buildDraftSnapshotFromState,
} from './draft-snapshot-state';

describe('buildDraftSnapshotFromState', () => {
  it('maps state input to a draft snapshot', () => {
    const snapshot = buildDraftSnapshotFromState({
      search: 'abc',
      pincodeSearch: '560001',
      dateRange: { start: new Date('2026-07-01'), end: new Date('2026-07-31'), label: 'Jul 2026' },
      agingAsOf: '2026-07-31',
      dateFilterColumn: 'dtrndate',
      selectedOfficeIds: ['101'],
      selectedCallTypes: ['Breakdown'],
      selectedStatus: ['open'],
      priorityFilter: ['P1'],
      portalFilter: ['portal'],
      repairFilter: ['major'],
      selectedState: ['KA'],
      selectedCity: ['BLR'],
      selectedRegion: ['South'],
      selectedAccount: ['A1'],
      selectedBranch: ['101'],
      selectedFranchisee: ['201'],
      selectedTechnician: ['T1'],
    });

    expect(snapshot.search).toBe('abc');
    expect(snapshot.pincodeSearch).toBe('560001');
    expect(snapshot.selectedCallTypes).toEqual(['Breakdown']);
    expect(snapshot.selectedBranch).toEqual(['101']);
  });

  it('builds a cleared snapshot while preserving reset date config', () => {
    const snapshot = buildClearedDraftSnapshotFromState(
      {
        search: 'abc',
        pincodeSearch: '560001',
        dateRange: { start: new Date('2026-07-01'), end: new Date('2026-07-31'), label: 'Jul 2026' },
        agingAsOf: '2026-07-31',
        dateFilterColumn: 'dtrndate',
        selectedOfficeIds: ['101'],
        selectedCallTypes: ['Breakdown'],
        selectedStatus: ['open'],
        priorityFilter: ['P1'],
        portalFilter: ['portal'],
        repairFilter: ['major'],
        selectedState: ['KA'],
        selectedCity: ['BLR'],
        selectedRegion: ['South'],
        selectedAccount: ['A1'],
        selectedBranch: ['101'],
        selectedFranchisee: ['201'],
        selectedTechnician: ['T1'],
      },
      { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59, 999), label: 'Aug 2026' },
      'bm_approved_at'
    );

    expect(snapshot.search).toBe('');
    expect(snapshot.selectedCallTypes).toEqual([]);
    expect(snapshot.dateFilterColumn).toBe('bm_approved_at');
    expect(snapshot.dateRange.label).toBe('Aug 2026');
    const today = toDateString(new Date());
    expect(snapshot.agingAsOf).toBe(today < '2026-08-31' ? today : '2026-08-31');
  });
});
