import { escapeCsvCell } from '@/lib/utils/csv';
import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterExportRow,
  WarrantyMasterSerialRow,
} from './types';

export function exportWarrantyMasterCsv(rows: WarrantyMasterAggregateRow[]): string {
  const headers = ['Customer Subgroup', 'Group', 'Warranty period (in Months)', 'Count of M/c'];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [r.customerSubgroup, r.groupName, r.warrantyMonths, r.machineCount].map(escapeCsvCell).join(',')
    ),
  ];
  return lines.join('\r\n');
}

/** Export one CSV row per imported warranty-master machine with all persisted import fields. */
export function exportWarrantyMasterDetailedCsv(rows: WarrantyMasterExportRow[]): string {
  const headers = [
    'Bill.Doc.',
    'Invoice Dt',
    'Material',
    'Serial Number',
    'Group Name',
    'Material Group',
    'Product Subgroup',
    'Customer Number-Sold-To-Party',
    'Cust.Subgrp (CGRP1)',
    'Ship-To-Party Name1',
    'Ship-To-Party State',
    'Ship-To-Party City',
    'Inventory Number',
    'Warranty Start Date',
    'Warranty End Date',
    'City',
    'PIN Code',
    'Warranty Months',
    'Is Active',
  ];

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [
        r.billingDoc ?? '',
        r.billingDate ?? '',
        r.material,
        r.serialNo,
        r.groupName,
        r.materialGroup,
        r.productSubgroup ?? '',
        r.customerName,
        r.customerSubgroup ?? '',
        r.shipToParty ?? '',
        r.shipToState ?? '',
        r.shipToCity ?? '',
        r.inventoryNumber ?? '',
        r.warrStartDt ?? '',
        r.warrEndDt ?? '',
        r.city ?? '',
        r.pinCode ?? '',
        r.warrantyMonths,
        r.isActive ? 'Yes' : 'No',
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];

  return lines.join('\r\n');
}

export function exportWarrantyMasterSerialsCsv(rows: WarrantyMasterSerialRow[]): string {
  const headers = [
    'Serial No',
    'Customer Subgroup',
    'Group',
    'FG Model',
    'Warranty (Months)',
    'Warranty Start Date',
    'Warranty End Date',
    'Status',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [
        r.serialNo,
        r.customerSubgroup ?? '(Unknown)',
        r.groupName,
        r.fgModel,
        r.warrantyMonths,
        r.warrStartDt ?? '',
        r.warrEndDt ?? '',
        r.isActive ? 'Active' : 'Expired',
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return lines.join('\r\n');
}
