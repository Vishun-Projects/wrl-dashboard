import {
  applyArcpDetailExportApprovedAmounts,
  mergeArcpDetailRows,
  type ArcpClaimsDetailRow,
  type ArcpDateFilterColumn,
} from './query';
import { resolveArcpItemCategoryDisplay } from './labels';
import type { ArcpClaimsTableModel, ArcpClaimsTotals } from './table';
import { responseForCsvStream } from '@/lib/net/csv-gzip-response';
import { formatArcpClaimsExportDate } from '@/lib/read-model/arcp/dates';
import { escapeCsvCell } from '@/lib/utils/csv';

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(',');
}

async function downloadCsv(csv: string, fileName: string): Promise<void> {
  const { triggerBlobDownload } = await import('@/features/report/download');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  await triggerBlobDownload(blob, fileName);
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

export async function downloadArcpClaimsCsv(model: ArcpClaimsTableModel, fileName: string): Promise<void> {
  await downloadCsv(buildArcpClaimsCsv(model), fileName);
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
  return finalizeArcpDetailExportRows(mergeArcpDetailRows(rows), options);
}

export function finalizeArcpDetailExportRows(
  rows: ArcpClaimsDetailRow[],
  options: {
    dateFilterColumn?: ArcpDateFilterColumn | null;
    includeTravel?: boolean;
  }
): ArcpClaimsDetailRow[] {
  let prepared = applyArcpDetailExportApprovedAmounts(rows, options.dateFilterColumn);
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

function buildArcpClaimsDetailTotalsNoteLine(): string {
  return csvRow([
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
  ]);
}

function buildArcpClaimsDetailTotalsLine(options: ArcpDetailExportOptions): string {
  return csvRow([
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
  ]);
}

export function buildArcpClaimsDetailCsvLines(
  rows: ArcpClaimsDetailRow[],
  options: ArcpDetailExportOptions
): string[] {
  const lines = [buildArcpClaimsDetailHeaderLine()];

  for (const row of rows) {
    lines.push(buildArcpClaimsDetailRowCsvLine(row));
  }

  lines.push(...buildArcpClaimsDetailFooterLines(options));
  return lines;
}

export function buildArcpClaimsDetailHeaderLine(): string {
  return csvRow([...DETAIL_HEADERS]);
}

export function buildArcpClaimsDetailRowCsvLine(row: ArcpClaimsDetailRow): string {
  return csvRow([
    row.vucnno,
    row.branch_name,
    row.franchisee_name,
    formatArcpClaimsExportDate(row.call_date),
    formatArcpClaimsExportDate(row.solve_date),
    formatArcpClaimsExportDate(row.bm_approved_date),
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
  ]);
}

export function buildArcpClaimsDetailFooterLines(options: ArcpDetailExportOptions): string[] {
  return [
    csvRow([]),
    buildArcpClaimsDetailTotalsNoteLine(),
    buildArcpClaimsDetailTotalsLine(options),
  ];
}

export function buildArcpClaimsDetailCsvFileName(startDate: string, endDate: string): string {
  return `ARCP_Claims_Detail_${startDate}_${endDate}.csv`;
}

export function buildArcpClaimsDetailCsv(
  rows: ArcpClaimsDetailRow[],
  options: ArcpDetailExportOptions
): string {
  return buildArcpClaimsDetailCsvLines(rows, options).join('\r\n');
}

export function createArcpClaimsDetailCsvResponse(
  rows: ArcpClaimsDetailRow[],
  fileName: string,
  options: ArcpDetailExportOptions
): Response {
  const encoder = new TextEncoder();
  const lines = buildArcpClaimsDetailCsvLines(rows, options);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('\uFEFF'));
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\r\n`));
      }
      controller.close();
    },
  });

  return responseForCsvStream(stream, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
}

export async function downloadArcpClaimsDetailCsv(
  rows: ArcpClaimsDetailRow[],
  fileName: string,
  options: ArcpDetailExportOptions
): Promise<void> {
  await downloadCsv(buildArcpClaimsDetailCsv(rows, options), fileName);
}
