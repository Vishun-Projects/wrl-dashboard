import assert from 'node:assert/strict';
import { zss02RowToExportValues, zss02WorkbookFilename } from './excel-export';
import type { Zss02Row } from '@/modules/zss02/types';

const row: Zss02Row = {
  id: 1,
  importId: 'x',
  plant: '1140',
  plantName: '1140 - TEST',
  itemGroup: 'Compressor',
  issue: 'cancelled',
  issueDetail: 'Cancelled',
  vendorNo: '1',
  vendorName: 'A',
  material: 'M',
  materialDescription: 'D',
  barcode: '241223211753702666',
  soConRtn: '',
  soLoan: '25B1',
  loanDate: '18.02.2025',
  loanRtnDate: '',
  cnsmpDate: '',
  noCnsmpCount: '1',
  saleDate: '',
  saleRtnDate: '',
};

const values = zss02RowToExportValues(row);
assert.equal(values[0], 'Cancelled');
assert.equal(values[1], '1140 - TEST');
assert.equal(values[4], 'Compressor');
assert.equal(values[7], '241223211753702666');
assert.equal(zss02WorkbookFilename('30-09-2026'), 'ZSS02_30092026.xlsx');

console.log('zss02 excel-export.check: ok');
