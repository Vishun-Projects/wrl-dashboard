import { describe, expect, it } from 'vitest';
import {
  calcMonths,
  cleanCustomerName,
  mapSheetHeaders,
  parseDateVal,
  remapCustomerSubgroup,
} from './import-parse';

describe('remapCustomerSubgroup', () => {
  it('renames exact Pepsi only', () => {
    expect(remapCustomerSubgroup('Pepsi')).toBe('Pepsi-Bott');
    expect(remapCustomerSubgroup('pepsi')).toBe('Pepsi-Bott');
    expect(remapCustomerSubgroup(' PEPSI ')).toBe('Pepsi-Bott');
  });

  it('leaves Pepsi-Bott and other values alone', () => {
    expect(remapCustomerSubgroup('Pepsi-Bott')).toBe('Pepsi-Bott');
    expect(remapCustomerSubgroup('PepsiCo')).toBe('PepsiCo');
    expect(remapCustomerSubgroup('Nestle')).toBe('Nestle');
  });
});

describe('cleanCustomerName', () => {
  it('drops digit-only sold-to numbers', () => {
    expect(cleanCustomerName('1000123')).toBe('');
    expect(cleanCustomerName(' 55 ')).toBe('');
  });

  it('keeps real names', () => {
    expect(cleanCustomerName('PepsiCo India')).toBe('PepsiCo India');
  });
});

describe('calcMonths', () => {
  it('is end minus start in calendar months, not a default 12', () => {
    expect(calcMonths('2026-01-05', '2026-01-05')).toBe(0);
    expect(calcMonths('2025-01-05', '2026-01-05')).toBe(12);
    expect(calcMonths('2025-01-05', '2026-01-04')).toBe(11);
    expect(calcMonths(null, '2026-01-05')).toBe(0);
  });
});

describe('parseDateVal', () => {
  it('parses dotted Indian dates and Excel serials', () => {
    expect(parseDateVal('11.06.2022')).toBe('2022-06-11');
    expect(parseDateVal(43102)).toBe('2018-01-02');
    expect(parseDateVal('2022-06-11')).toBe('2022-06-11');
  });
});

describe('mapSheetHeaders', () => {
  it('maps Warrantydwnlod and FINAL header names', () => {
    const dwn = mapSheetHeaders([
      'Bill.Doc.',
      'Invoice Dt',
      'Serial Number',
      'Customer Number-Sold-To-Party',
      'Customer Subgroup',
      'Warranty Start Date',
      'Warranty End Date',
    ]);
    expect(dwn.billingDoc).toBe('Bill.Doc.');
    expect(dwn.billingDate).toBe('Invoice Dt');
    expect(dwn.serial).toBe('Serial Number');
    expect(dwn.customer).toBe('Customer Number-Sold-To-Party');
    expect(dwn.customerSubgroup).toBe('Customer Subgroup');
    expect(dwn.warrStart).toBe('Warranty Start Date');
    expect(dwn.warrEnd).toBe('Warranty End Date');

    const final = mapSheetHeaders([
      'Billing Document',
      'Billing Date',
      'Serial Number',
      'Customer-Sold-To-Party Name',
      'Customer Subgroup',
      'Warr. Date',
      'WtyEnd',
    ]);
    expect(final.billingDoc).toBe('Billing Document');
    expect(final.customer).toBe('Customer-Sold-To-Party Name');
    expect(final.warrStart).toBe('Warr. Date');
    expect(final.warrEnd).toBe('WtyEnd');
  });
});
