import type { ArcpClaimsDetailRow } from '@/lib/arcp-claims-query';
import type { ArcpClaimsTableModel } from '@/lib/arcp-claims-table';
import { escapeCsvCell } from '@/lib/csv-utils';

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

const DETAIL_HEADERS = [
  'Call No',
  'Calls2Fault Code',
  'Call No',
  'Franchisee Code',
  'Branch',
  'Franchisee',
  'Call Date',
  'Solve Date',
  'BM Approved Date',
  'HO Approved Date',
  'Call Type',
  'Item Category',
  'Local/Upcountry',
  'Major/Minor',
  'Line Type',
  'Rate',
  'Distance',
  'Amount Payable',
  'Branch Approved',
  'HO Approved',
  'Raw Charge Payable',
  'Raw BM Approved',
  'Raw HO Approved',
  'Raw Approval1 Amount',
  'Raw Approval2 Amount',
  'Summary Section',
  'Summary Sub-Row',
  'Payable Minus Branch',
  'Payable Minus HO',
] as const;

export function buildArcpClaimsDetailCsv(rows: ArcpClaimsDetailRow[]): string {
  const lines = [csvRow([...DETAIL_HEADERS])];

  for (const row of rows) {
    lines.push(
      csvRow([
        row.vucnno,
        row.calls2fault_code,
        row.call_no,
        row.franchisee_code,
        row.branch_name,
        row.franchisee_name,
        row.call_date,
        row.solve_date,
        row.bm_approved_date,
        row.ho_approved_date,
        row.call_type,
        row.item_category,
        row.local_upcountry,
        row.major_minor,
        row.line_type,
        row.rate,
        row.distance,
        row.amount_payable,
        row.branch_approved,
        row.ho_approved,
        row.raw_nchargespayable,
        row.raw_nbmapprovedamt,
        row.raw_nhoapprovedamt,
        row.raw_napproval1amount,
        row.raw_napproval2amount,
        row.summary_section,
        row.summary_sub_row,
        row.payable_minus_branch,
        row.payable_minus_ho,
      ])
    );
  }

  return lines.join('\r\n');
}

export function downloadArcpClaimsDetailCsv(rows: ArcpClaimsDetailRow[], fileName: string): void {
  downloadCsv(buildArcpClaimsDetailCsv(rows), fileName);
}
