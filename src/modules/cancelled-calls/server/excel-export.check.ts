import assert from 'node:assert/strict';
import { cancelledCallsOverview } from './excel-export';
import type { CancelledCallRow } from '@/modules/cancelled-calls/types';

const row = (branchName: string): CancelledCallRow => ({
  vtrnno: '26C00001',
  ncode: 1,
  ncancelreason: 1,
  cancelReason: 'Test',
  cancelledAt: '2026-08-31T10:00:00+05:30',
  loggedAt: '2026-08-30T10:00:00+05:30',
  callType: 'BD',
  branchName,
  franchiseeName: null,
  franchiseeVendorCode: null,
  partyName: 'Party',
  partyProfile: null,
  itemCode: null,
  serial: null,
  complaint: null,
  region: null,
});

const byBranch = new Map<string, CancelledCallRow[]>([
  ['Mumbai', [row('Mumbai'), row('Mumbai')]],
  ['Delhi', [row('Delhi')]],
]);

const overview = cancelledCallsOverview(byBranch);
assert.equal(overview.length, 2);
assert.equal(overview[0]?.branch, 'Mumbai');
assert.equal(overview[0]?.count, 2);
assert.equal(overview[1]?.branch, 'Delhi');
console.log('cancelled-calls excel-export.check ok');
