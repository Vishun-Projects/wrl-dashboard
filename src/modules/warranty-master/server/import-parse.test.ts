import { describe, expect, it } from 'vitest';
import {
  calcMonths,
  cellText,
  mapSheetHeaders,
  parseDateVal,
} from './import-parse';

describe('cellText', () => {
  it('trims and returns null for empty', () => {
    expect(cellText(null)).toBeNull();
    expect(cellText('')).toBeNull();
    expect(cellText('   ')).toBeNull();
    expect(cellText(' FG FREEZR ')).toBe('FG FREEZR');
    expect(cellText(1000123)).toBe('1000123');
  });
});

describe('calcMonths', () => {
  it('is inclusive and snaps up to a 6-month step', () => {
    expect(calcMonths('2026-01-05', '2026-01-05')).toBe(0);
    expect(calcMonths('2025-01-05', '2026-01-05')).toBe(12);
    expect(calcMonths('2025-01-05', '2026-01-04')).toBe(12);
    expect(calcMonths('2025-08-06', '2029-08-05')).toBe(48);
    expect(calcMonths('2026-07-09', '2028-01-08')).toBe(18);
    expect(calcMonths('2022-03-11', '2027-03-10')).toBe(60);
    expect(calcMonths(null, '2026-01-05')).toBe(0);
  });
});

describe('parseDateVal', () => {
  it('parses dotted Indian dates and Excel serials', () => {
    expect(parseDateVal('11.06.2022')).toBe('2022-06-11');
    expect(parseDateVal('02.08.2022')).toBe('2022-08-02');
    expect(parseDateVal('02.01.2019')).toBe('2019-01-02');
    expect(parseDateVal(43102)).toBe('2018-01-02');
    expect(parseDateVal('2022-06-11')).toBe('2022-06-11');
  });
});

describe('mapSheetHeaders', () => {
  it('maps the canonical 15 Excel headers', () => {
    const mapped = mapSheetHeaders([
      'Bill.Doc.',
      'Invoice Dt',
      'Material',
      'Serial Number',
      'Group Name',
      'Material Group',
      'Customer Number-Sold-To-Party',
      'Customer Subgroup',
      'Ship-To-Party Name1',
      'Ship-To-Party State',
      'Ship-To-Party City',
      'Inventory Number',
      'Warranty Start Date',
      'Warranty End Date',
      'PIN Code',
    ]);
    expect(mapped.billingDoc).toBe('Bill.Doc.');
    expect(mapped.billingDate).toBe('Invoice Dt');
    expect(mapped.material).toBe('Material');
    expect(mapped.serial).toBe('Serial Number');
    expect(mapped.groupName).toBe('Group Name');
    expect(mapped.materialGroup).toBe('Material Group');
    expect(mapped.customer).toBe('Customer Number-Sold-To-Party');
    expect(mapped.customerSubgroup).toBe('Customer Subgroup');
    expect(mapped.shipTo).toBe('Ship-To-Party Name1');
    expect(mapped.state).toBe('Ship-To-Party State');
    expect(mapped.shipToCity).toBe('Ship-To-Party City');
    expect(mapped.inventory).toBe('Inventory Number');
    expect(mapped.warrStart).toBe('Warranty Start Date');
    expect(mapped.warrEnd).toBe('Warranty End Date');
    expect(mapped.pin).toBe('PIN Code');
    expect(mapped.productSubgroup).toBeUndefined();
    expect(mapped.city).toBeUndefined();
  });

  it('still maps FINAL-style aliases', () => {
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
