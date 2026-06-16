import {
  applyArcpDetailExportApprovedAmounts,
  mergeArcpDetailRows,
  type ArcpClaimsDetailRow,
  type ArcpDateFilterColumn,
} from './query';
import { resolveArcpItemCategoryDisplay } from './labels';
import type { ArcpClaimsTableModel, ArcpClaimsTotals } from './table';
import { escapeCsvCell } from '@/lib/utils/csv';

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(',');
}

function downloadCsv(csv: string, fileName: string): void {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildArcpClaimsCsv(model: ArcpClaimsTableModel): string {
  const lines = [
    csvRow([
      'Service Description',
      'Rate',
      'Qty',
      'Amount Payable',
      'Branch Approved',
      'HO Approved',
    ]),
  ];

  for (const row of model.rows) {
    if (row.kind === 'section-header') {
      lines.push(csvRow([row.serviceDescription, '', '', '', '', '']));
      continue;
    }

    if (row.kind === 'travel') {
      lines.push(
        csvRow([
          row.serviceDescription,
          row.rate,
          '',
          row.amountPayable,
          row.branchApproved,
          row.hoApproved,
        ])
      );
      continue;
    }

    lines.push(
      csvRow([
        row.serviceDescriptionSubLabel,
        row.rate,
        row.qty,
        row.amountPayable,
        row.branchApproved,
        row.hoApproved,
      ])
    );
  }

  lines.push(
    csvRow([
      'Total',
      '',
      model.totals.qty,
      model.totals.amountPayable,
      model.totals.branchApproved,
      model.totals.hoApproved,
    ])
  );

  return lines.join('\r\n');
}

export function downloadArcpClaimsCsv(model: ArcpClaimsTableModel, fileName: string): void {
  downloadCsv(buildArcpClaimsCsv(model), fileName);
}

export type ArcpDetailExportOptions = {
  totals: ArcpClaimsTotals;
};

export function prepareArcpDetailExportRows(
  rows: ArcpClaimsDetailRow[],
  options: {
    dateFilterColumn?: ArcpDateFilterColumn | null;
    includeTravel?: boolean;
  }
): ArcpClaimsDetailRow[] {
  let prepared = mergeArcpDetailRows(rows);
  prepared = applyArcpDetailExportApprovedAmounts(prepared, options.dateFilterColumn);
  if (options.includeTravel === false) {
    prepared = prepared.filter((row) => row.line_type !== 'Travel');
  }
  return prepared;
}

export function sumArcpDetailExportTotals(rows: ArcpClaimsDetailRow[]): ArcpClaimsTotals {
  return rows.reduce(
    (acc, row) => ({
      qty: acc.qty,
      amountPayable: acc.amountPayable + (Number(row.amount_payable) || 0),
      branchApproved: acc.branchApproved + (Number(row.branch_approved) || 0),
      hoApproved: acc.hoApproved + (Number(row.ho_approved) || 0),
    }),
    { qty: 0, amountPayable: 0, branchApproved: 0, hoApproved: 0 }
  );
}

const DETAIL_HEADERS = [
  'Serial No',
  'Branch',
  'Franchisee',
  'Call Date',
  'Solve Date',
  'BM Approved Date',
  'Call Type',
  'Item Category',
  'Local/Upcountry',
  'Major/Minor',
  'Line Type',
  'Distance',
  'Charge Payable',
  'BM Approved',
  'HO Approved',
  'CRM Raw Charge Payable',
  'CRM Raw BM Approved',
  'Summary Section',
  'Summary Sub-Row',
] as const;

export function buildArcpClaimsDetailCsv(
  rows: ArcpClaimsDetailRow[],
  options: ArcpDetailExportOptions
): string {
  const lines = [csvRow([...DETAIL_HEADERS])];

  for (const row of rows) {
    lines.push(
      csvRow([
        row.vucnno,
        row.branch_name,
        row.franchisee_name,
        row.call_date,
        row.solve_date,
        row.bm_approved_date,
        row.call_type,
        resolveArcpItemCategoryDisplay(row.item_category),
        row.local_upcountry,
        row.major_minor,
        row.line_type,
        row.distance,
        row.amount_payable,
        row.branch_approved,
        row.ho_approved,
        row.raw_nchargespayable,
        row.raw_nbmapprovedamt,
        row.summary_section,
        row.summary_sub_row,
      ])
    );
  }

  lines.push(csvRow([]));
  lines.push(
    csvRow([
      'Totals row matches on-screen Service tally for current filters and view options.',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
  );
  lines.push(
    csvRow([
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      options.totals.amountPayable,
      options.totals.branchApproved,
      options.totals.hoApproved,
      '',
      '',
      '',
      '',
    ])
  );

  return lines.join('\r\n');
}

export function downloadArcpClaimsDetailCsv(
  rows: ArcpClaimsDetailRow[],
  fileName: string,
  options: ArcpDetailExportOptions
): void {
  downloadCsv(buildArcpClaimsDetailCsv(rows, options), fileName);
}
