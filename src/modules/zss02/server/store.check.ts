import assert from 'node:assert/strict';
import {
  normalizeZss02FileName,
  parseBarcodeSearch,
  parseSapLoanDate,
  partitionByPlantScope,
  plantsInRows,
} from './store';
import type { Zss02ParsedRow } from '@/modules/zss02/types';

const sample = (plant: string): Zss02ParsedRow => ({
  plant,
  vendorNo: '1',
  vendorName: 'A',
  material: 'M',
  materialDescription: 'D',
  barcode: 'B',
  soConRtn: '',
  soLoan: 'SO1',
  loanDate: '18.02.2025',
  loanRtnDate: '',
  cnsmpDate: '',
  noCnsmpCount: '1',
  saleDate: '',
  saleRtnDate: '',
});

assert.equal(parseSapLoanDate('18.02.2025'), '2025-02-18');
assert.equal(parseSapLoanDate('  .  .'), null);
assert.equal(parseSapLoanDate(''), null);
assert.equal(parseSapLoanDate('32.01.2025'), null);

const open = partitionByPlantScope([sample('1140'), sample('1199')], null);
assert.equal(open.keep.length, 2);
assert.equal(open.skippedOutOfScope, 0);

const scoped = partitionByPlantScope([sample('1140'), sample('1199')], ['1140']);
assert.equal(scoped.keep.length, 1);
assert.equal(scoped.keep[0]?.plant, '1140');
assert.equal(scoped.skippedOutOfScope, 1);

assert.equal(normalizeZss02FileName('  1140.HTML  '), '1140.HTML');
assert.deepEqual(plantsInRows([sample('1140'), sample('1135'), sample('1140')]), [
  '1135',
  '1140',
]);

assert.deepEqual(parseBarcodeSearch('222309061121\n241223211753702666'), [
  '222309061121',
  '241223211753702666',
]);
assert.deepEqual(parseBarcodeSearch('a\na\nb'), ['a', 'b']);
assert.deepEqual(parseBarcodeSearch('  x , y ; z  '), ['x', 'y', 'z']);

console.log('zss02 store.check: ok');
