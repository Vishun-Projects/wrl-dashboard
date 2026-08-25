import { describe, expect, it } from 'vitest';
import {
  normalizeVendorCode,
  reconcileStock,
} from './reconciliation-engine';
import { SapSupplierGroup } from './sap-parser';
import { CrmStockRow, CrmVendorPlant } from './crm-query';

describe('reconciliation-engine', () => {
  describe('normalizeVendorCode', () => {
    it('strips non-numeric suffixes', () => {
      expect(normalizeVendorCode('308278-BLK')).toBe('308278');
      expect(normalizeVendorCode('308278')).toBe('308278');
      expect(normalizeVendorCode('  123456-MUM ')).toBe('123456');
    });

    it('returns raw trimmed if non-matching format', () => {
      expect(normalizeVendorCode('ABC-123')).toBe('ABC-123');
    });
  });

  describe('reconcileStock', () => {
    it('reconciles and unifies subcontractor names across SAP and CRM datasets', () => {
      const sapGroups: SapSupplierGroup[] = [
        {
          supplierCode: '308278-BLK',
          supplierName: 'AJAY MUNNALAL GUPTA MUMBAI',
          items: [
            {
              materialCode: '1513755',
              description: 'ICF HICOOL 12A 230H SAC',
              plantCode: '1171',
              batch: '',
              quantity: 4,
              unit: 'NOS',
            },
          ],
        },
      ];

      const crmRows: CrmStockRow[] = [
        {
          plantCode: '1171',
          plantName: 'Mumbai',
          vendorCode: '308278',
          vendorName: 'AJAY GUPTA', // CRM has a slightly different name
          materialCode: '1513755',
          materialDescription: 'ICF HICOOL 12A 230H SAC',
          materialGroup: 'MOTOR',
          uom: 'NOS',
          crmQty: 3,
        },
        {
          plantCode: '1171',
          plantName: 'Mumbai',
          vendorCode: '308278',
          vendorName: 'AJAY GUPTA',
          materialCode: '9999999', // Only in CRM
          materialDescription: 'Only CRM Item',
          materialGroup: 'OTHER',
          uom: 'NOS',
          crmQty: 10,
        },
      ];

      const result = reconcileStock(sapGroups, crmRows);

      // Verify overall counts
      expect(result.summary.totalRecords).toBe(2);

      // Verify unified vendor name on BOTH rows (preferring SAP name "AJAY MUNNALAL GUPTA MUMBAI")
      const row1 = result.rows.find(r => r.material === '1513755');
      const row2 = result.rows.find(r => r.material === '9999999');

      expect(row1).toBeDefined();
      expect(row1?.vendorName).toBe('AJAY MUNNALAL GUPTA MUMBAI');
      expect(row1?.sapQty).toBe(4);
      expect(row1?.crmQty).toBe(3);
      expect(row1?.difference).toBe(1); // 4 - 3 = 1

      expect(row2).toBeDefined();
      expect(row2?.vendorName).toBe('AJAY MUNNALAL GUPTA MUMBAI'); // Canonical name mapped even for CRM-only row!
      expect(row2?.sapQty).toBe(0);
      expect(row2?.crmQty).toBe(10);
      expect(row2?.difference).toBe(-10); // 0 - 10 = -10
    });

    it('overrides SAP plantCode with CRM parent plantCode if vendorPlantMap is provided', () => {
      const sapGroups: SapSupplierGroup[] = [
        {
          supplierCode: '308776-MUM',
          supplierName: 'VENDOR_A',
          items: [
            {
              materialCode: '1110714',
              description: 'ITEM_A',
              plantCode: '1143', // Mismatching SAP plant code
              batch: '',
              quantity: 2,
              unit: 'NOS',
            },
          ],
        },
      ];

      const crmRows: CrmStockRow[] = [
        {
          plantCode: '1175', // Parent plant code in CRM
          plantName: 'Kolkata Parent',
          vendorCode: '308776',
          vendorName: 'VENDOR_A',
          materialCode: '1110714',
          materialDescription: 'ITEM_A',
          materialGroup: 'OTHER',
          uom: 'NOS',
          crmQty: 2,
        },
      ];

      const vendorPlantMap = new Map<string, CrmVendorPlant>([
        ['308776', { plantCode: '1175', plantName: 'Kolkata Parent' }]
      ]);

      const result = reconcileStock(sapGroups, crmRows, vendorPlantMap);

      // Verify the records have merged on plant code 1175
      expect(result.summary.totalRecords).toBe(1);
      const row = result.rows[0];
      expect(row).toBeDefined();
      expect(row.plant).toBe('1175');
      expect(row.sapQty).toBe(2);
      expect(row.crmQty).toBe(2);
      expect(row.difference).toBe(0); // Perfect match!
    });
  });
});
