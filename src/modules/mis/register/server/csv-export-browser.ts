/**
 * Browser-safe register CSV helpers (no CRM proxy / nodemailer).
 * Server streaming with postQuery stays in csv-export.ts.
 */
import { normalizeCrmCallRow } from '@/lib/call/row/normalize';
import { formatRegisterExportDate } from '@/modules/mis/register/services/register-export-format';
import { formatRegisterMajorMinor } from '@/modules/mis/register/services/register-export-format';
import { formatRegisterRepairDone } from '@/modules/mis/register/services/register-export-format';
import { REGISTER_EXPORT_COLUMNS } from '@/modules/mis/register/services/table-columns';
import { escapeCsvCell } from '@/lib/utils/csv';
import {
  triggerBlobDownload,
  blobToPreparedExport,
  type PreparedFileExport,
} from '@/modules/mis/download';

const CSV_COLUMNS = REGISTER_EXPORT_COLUMNS;

export function rowForCsv(raw: Record<string, unknown>): Record<string, unknown> {
  const row = normalizeCrmCallRow(raw);
  const branch = row.officename ?? row.resolved_branch_name ?? row.branch_office_name ?? '';
  const franchisee =
    row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '';
  const isCancelled =
    row.callstatus === 'Cancel' ||
    row.Status === 'Cancel' ||
    (row.ncancelreason != null &&
      String(row.ncancelreason).trim() !== '' &&
      String(row.ncancelreason) !== '0' &&
      String(row.ncancelreason) !== '2');
  const isSolved =
    !isCancelled &&
    (row.Status === 'Closed' ||
      row.callstatus === 'Solved' ||
      String(row.callsolved).toLowerCase() === 'true' ||
      String(row.callsolved) === '1');
  const statusText = isCancelled
    ? 'Cancelled'
    : isSolved
      ? row.Status === 'UNKNOWN'
        ? 'PENDING'
        : String(row.Status || row.callstatus || 'Solved')
      : String(row.Status || row.callstatus || 'OPEN');

  return {
    UniqueCallNo: row.UniqueCallNo,
    vcclid: row.vcclid ?? '',
    calltype: row.calltype,
    major_minor: formatRegisterMajorMinor(row),
    callsdtrndate: formatRegisterExportDate(row.callsdtrndate),
    PartyName: row.PartyName,
    officename: branch,
    region: row.region ?? '',
    account: row.account ?? '',
    franchisee_name: franchisee,
    Pincode: row.Pincode,
    itemname: row.itemname,
    callsvserialno: row.callsvserialno,
    WCO: row.WCO ?? '',
    serviceman: row.serviceman,
    vcomplaint: row.vcomplaint,
    repair_done: formatRegisterRepairDone(row.repair_done),
    display_status: statusText,
    solvedDate: isSolved ? formatRegisterExportDate(row.callsolveddate) : '',
    cancelled_date: isCancelled
      ? formatRegisterExportDate(row.cancelled_date ?? row.cancelled_at)
      : '',
    cancel_reason: isCancelled ? row.cancel_reason || '' : '',
    remarks: row.vsolveremarks || '',
    bm_approved_date: formatRegisterExportDate(row.bm_approved_date) || '',
    vpersoncalling: row.vpersoncalling,
    vinsttel1: row.vinsttel1,
    vinstaddress: row.vinstaddress,
  };
}

export function registerRowToCsvLine(row: Record<string, unknown>): string {
  const mapped = rowForCsv(row);
  return CSV_COLUMNS.map((col) => escapeCsvCell(mapped[col.key as keyof typeof mapped])).join(',');
}

/** Build RFC4180-style CSV with CRLF line endings (Excel-friendly). */
export function buildRegisterCsvContent(rows: Record<string, unknown>[]): string {
  const lines = [CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(registerRowToCsvLine(row));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Build a register CSV blob for queued export (caller saves via user click when needed). */
export function prepareRegisterCsvExport(
  rows: Record<string, unknown>[],
  filename?: string
): PreparedFileExport {
  const csv = buildRegisterCsvContent(rows);
  const baseName =
    filename ?? `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  return blobToPreparedExport(
    new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }),
    baseName
  );
}

/** Trigger a register CSV download in the browser (UTF-8 BOM for Excel). */
export async function downloadRegisterCsvInBrowser(
  rows: Record<string, unknown>[],
  filename?: string
): Promise<void> {
  const prepared = prepareRegisterCsvExport(rows, filename);
  await triggerBlobDownload(prepared.blob, prepared.filename, {
    objectUrl: prepared.objectUrl,
  });
}
