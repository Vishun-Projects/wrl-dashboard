import assert from 'node:assert/strict';
import { buildArcpProvisionTableModel } from './table';
import type { ArcpProvisionAggregateRow } from '@/modules/arcp-provision/types';

const model = buildArcpProvisionTableModel([
  {
    branch_id: '24',
    branch_name: 'JAIPUR BRANCH',
    franchisee_id: '144',
    franchisee_name: 'Vendor A',
    vendor_code: '309001',
    qty: 4,
    rate_mst: 800,
    rate_crm: 800,
    variance: 0,
    travel_amount: 280,
  },
  {
    branch_id: '24',
    branch_name: 'JAIPUR BRANCH',
    franchisee_id: '145',
    franchisee_name: 'Vendor C',
    vendor_code: '309003',
    qty: 1,
    rate_mst: 200,
    rate_crm: 200,
    variance: 0,
    travel_amount: 70,
  },
  {
    branch_id: '17',
    branch_name: 'DELHI BRANCH',
    franchisee_id: '200',
    franchisee_name: 'Vendor B',
    vendor_code: '309002',
    qty: 2,
    rate_mst: 1000,
    rate_crm: 900,
    variance: -100,
    travel_amount: 0,
  },
] satisfies ArcpProvisionAggregateRow[]);

assert.equal(model.branches.length, 2);
assert.equal(model.branches[0]?.branchName, 'DELHI BRANCH');
assert.equal(model.branches[0]?.vendors.length, 1);
assert.equal(model.branches[1]?.branchName, 'JAIPUR BRANCH');
assert.equal(model.branches[1]?.vendors.length, 2);
assert.equal(model.branches[1]?.travelAmount, 350);
assert.equal(model.totals.travelAmount, 350);
assert.equal(model.totals.rateMst, 2000);

console.log('arcp-provision table check ok');
