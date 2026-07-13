import { decodeCsvBuffer, parsePipeDelimitedCsv } from '@/lib/mis-client-import/parse-csv';
import { parseSpreadsheetMatrix, parseXlsxBuffer } from '@/lib/mis-client-import/parse-xlsx';
import type { MisClientSourceConfig } from '@/lib/mis-client-import/types';
import {
  isWrlmisBuffer,
  isWrlmisFileName,
  unpackWrlmisBuffer,
} from '@/lib/mis-client-import/wrlmis-pack';
import * as XLSX from 'xlsx';

export type DetectedFileFormat = 'csv' | 'spreadsheet' | 'wrlmis';
export type SniffedSource = 'coke' | 'cadbury' | 'unknown';

export type ParseImportResult = {
  rawRows: Record<string, string>[];
  detectedFormat: DetectedFileFormat | null;
  detectedHeaderRow: number | null;
  sniffedSource: SniffedSource;
  warnings: string[];
};

const HEADER_SCAN_LIMIT = 30;

type SheetMatrix = (string | number | Date | null)[][];

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '').trim();
}

function rowHeaders(row: unknown[] | undefined): string[] {
  if (!row?.length) return [];
  return row.map(normalizeHeader).filter(Boolean);
}

export function isSpreadsheetMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return true;
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return true;
  return false;
}

function looksLikePipeCsv(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let text: string;
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    text = sample.toString('utf16le');
  } else if (!sample.includes(0x00)) {
    text = sample.toString('utf8');
  } else {
    return false;
  }
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return firstLine.includes('|') && /ticket|vdate|callstatus|branchname/i.test(firstLine);
}

export function detectFileFormat(buffer: Buffer, fileName: string): DetectedFileFormat {
  if (isWrlmisFileName(fileName) || isWrlmisBuffer(buffer)) return 'wrlmis';
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xls' || ext === 'xlsx') return 'spreadsheet';
  if (ext === 'csv') return 'csv';
  if (isSpreadsheetMagic(buffer)) return 'spreadsheet';
  if (looksLikePipeCsv(buffer)) return 'csv';
  if (buffer.includes(0x00) || isSpreadsheetMagic(buffer)) return 'spreadsheet';
  return 'csv';
}

export function sniffSourceFromHeaders(headers: string[]): SniffedSource {
  const normalized = headers.map((h) => h.toLowerCase());
  const has = (pattern: RegExp) => normalized.some((h) => pattern.test(h));

  const hasCokeCallNo = has(/^call\s*no\.?$/);
  const hasCokeEntity = has(/^entity\s*name$/);
  const hasCokeLogDate = has(/^call\s*log\s*date$/);

  if (hasCokeCallNo && (hasCokeEntity || hasCokeLogDate)) {
    return 'coke';
  }

  const hasCadburyTicket = has(/^\.?ticket\s*number$/);
  const hasCadburyVDate = has(/^v\s*date$/);
  const hasCadburyCallStatus = has(/^call\s*status$/);
  const hasCadburyBranch = has(/^branch\s*name$/);

  if (hasCadburyTicket && (hasCadburyVDate || hasCadburyCallStatus || hasCadburyBranch)) {
    return 'cadbury';
  }

  return 'unknown';
}

export function sniffSourceFromMatrix(matrix: SheetMatrix): SniffedSource {
  for (let i = 0; i < Math.min(matrix.length, HEADER_SCAN_LIMIT); i++) {
    const sniffed = sniffSourceFromHeaders(rowHeaders(matrix[i]));
    if (sniffed !== 'unknown') return sniffed;
  }
  return 'unknown';
}

export function findHeaderRowIndex(matrix: SheetMatrix, preferredSource: string): number | null {
  for (let i = 0; i < Math.min(matrix.length, HEADER_SCAN_LIMIT); i++) {
    const headers = rowHeaders(matrix[i]);
    const sniffed = sniffSourceFromHeaders(headers);
    if (sniffed === 'unknown') continue;
    if (preferredSource === 'cadbury' && sniffed === 'cadbury') return i + 1;
    if (preferredSource === 'coke' && sniffed === 'coke') return i + 1;
    if (preferredSource !== 'coke' && preferredSource !== 'cadbury') return i + 1;
  }
  return null;
}

export function readSpreadsheetMatrix(buffer: Buffer): SheetMatrix {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<SheetMatrix[number]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
}

function resolveHeaderRow(
  matrix: SheetMatrix,
  config: MisClientSourceConfig
): { headerRow: number; autoDetected: boolean } {
  const autoRow = findHeaderRowIndex(matrix, config.code);
  if (autoRow != null) {
    return {
      headerRow: autoRow,
      autoDetected: autoRow !== config.header_row_index,
    };
  }
  return {
    headerRow: config.header_row_index > 0 ? config.header_row_index : 1,
    autoDetected: false,
  };
}

function parseCsvBuffer(
  buffer: Buffer,
  delimiter: string
): { headers: string[]; rows: Record<string, string>[]; headerRow: number; sniffedSource: SniffedSource } {
  const content = decodeCsvBuffer(buffer);
  const parsed = parsePipeDelimitedCsv(content, delimiter);
  return {
    ...parsed,
    headerRow: 1,
    sniffedSource: sniffSourceFromHeaders(parsed.headers),
  };
}

function parseSpreadsheetBuffer(
  buffer: Buffer,
  config: MisClientSourceConfig,
  matrix?: SheetMatrix
): {
  rows: Record<string, string>[];
  headers: string[];
  headerRow: number | null;
  sniffedSource: SniffedSource;
  autoDetected: boolean;
} {
  const sheetMatrix = matrix ?? readSpreadsheetMatrix(buffer);
  if (!sheetMatrix.length) {
    return { rows: [], headers: [], headerRow: null, sniffedSource: 'unknown', autoDetected: false };
  }

  const { headerRow, autoDetected } = resolveHeaderRow(sheetMatrix, config);
  const parsed = parseSpreadsheetMatrix(sheetMatrix, headerRow);
  const headerSniff = sniffSourceFromHeaders(parsed.headers);
  return {
    rows: parsed.rows,
    headers: parsed.headers,
    headerRow,
    sniffedSource: headerSniff !== 'unknown' ? headerSniff : sniffSourceFromMatrix(sheetMatrix),
    autoDetected,
  };
}

export function sourceMismatchMessage(
  sniffed: SniffedSource,
  selectedCode: string
): string | null {
  if (sniffed === 'unknown' || sniffed === selectedCode) return null;
  if (sniffed === 'coke') {
    return (
      'This file looks like Coke CDMS (columns: Call No, Entity Name). ' +
      'Switch import source to Coke and retry.'
    );
  }
  if (sniffed === 'cadbury') {
    return (
      'This file looks like Cadbury VMS (.TicketNumber, VDate). ' +
      'Switch import source to Cadbury and retry.'
    );
  }
  return null;
}

export function emptyFileMessage(
  fileName: string,
  detectedFormat: DetectedFileFormat | null,
  sniffedSource: SniffedSource,
  headerRow: number | null
): string {
  const parts = [
    `No data rows found in "${fileName}".`,
    detectedFormat ? `Detected format: ${detectedFormat}.` : null,
    sniffedSource !== 'unknown' ? `File appears to be ${sniffedSource.toUpperCase()} format.` : null,
    headerRow != null ? `Header row tried: ${headerRow}.` : null,
    sniffedSource === 'coke'
      ? 'Upload Coke CDMS Excel under Coke (header row is after filter rows).'
      : null,
    sniffedSource === 'cadbury'
      ? 'Upload Cadbury VMS pipe CSV (VMSComplaintDetailsRpt.csv) or Excel (.xls/.xlsx).'
      : null,
    sniffedSource === 'unknown'
      ? 'Check that the file is not empty and you selected the correct import source.'
      : null,
  ].filter(Boolean);
  return parts.join(' ');
}

export async function parseImportFile(
  buffer: Buffer,
  fileName: string,
  config: MisClientSourceConfig
): Promise<ParseImportResult> {
  const warnings: string[] = [];
  const primaryFormat = detectFileFormat(buffer, fileName);

  if (primaryFormat === 'wrlmis') {
    const unpacked = unpackWrlmisBuffer(buffer);
    if (unpacked.packedAt) {
      warnings.push(`Unpacked WRLMIS1 pack (packed ${unpacked.packedAt}).`);
    } else {
      warnings.push('Unpacked WRLMIS1 pack.');
    }
    return {
      rawRows: unpacked.rows,
      detectedFormat: 'wrlmis',
      detectedHeaderRow: 1,
      sniffedSource: unpacked.sourceHint,
      warnings,
    };
  }

  const fallbackFormat: DetectedFileFormat =
    primaryFormat === 'csv' ? 'spreadsheet' : 'csv';

  const spreadsheetMatrix =
    primaryFormat === 'spreadsheet' || isSpreadsheetMagic(buffer)
      ? readSpreadsheetMatrix(buffer)
      : null;

  let fileSniff: SniffedSource = 'unknown';
  if (spreadsheetMatrix?.length) {
    fileSniff = sniffSourceFromMatrix(spreadsheetMatrix);
  } else {
    const content = decodeCsvBuffer(buffer);
    const firstLine = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
    if (firstLine) {
      const delim = config.delimiter ?? '|';
      const headers = firstLine.split(delim).map((h) => h.replace(/^"|"$/g, '').trim());
      fileSniff = sniffSourceFromHeaders(headers);
    }
  }

  let result:
    | ReturnType<typeof parseCsvBuffer>
    | ReturnType<typeof parseSpreadsheetBuffer>
    | null = null;
  let detectedFormat: DetectedFileFormat | null = null;

  if (primaryFormat === 'csv') {
    const csvResult = parseCsvBuffer(buffer, config.delimiter ?? '|');
    if (csvResult.rows.length > 0) {
      result = csvResult;
      detectedFormat = 'csv';
    }
  } else if (spreadsheetMatrix) {
    const sheetResult = parseSpreadsheetBuffer(buffer, config, spreadsheetMatrix);
    if (sheetResult.rows.length > 0) {
      result = sheetResult;
      detectedFormat = 'spreadsheet';
      if (sheetResult.autoDetected) {
        warnings.push(
          `Auto-detected header row ${sheetResult.headerRow} (config had ${config.header_row_index}).`
        );
      }
    }
  }

  if (!result || result.rows.length === 0) {
    if (fallbackFormat === 'csv') {
      const csvResult = parseCsvBuffer(buffer, config.delimiter ?? '|');
      if (csvResult.rows.length > 0) {
        result = csvResult;
        detectedFormat = 'csv';
        warnings.push(`Parsed as csv (config says ${config.file_kind}).`);
      }
    } else if (spreadsheetMatrix) {
      const sheetResult = parseSpreadsheetBuffer(buffer, config, spreadsheetMatrix);
      if (sheetResult.rows.length > 0) {
        result = sheetResult;
        detectedFormat = 'spreadsheet';
        warnings.push(`Parsed as spreadsheet (config says ${config.file_kind}).`);
        if (sheetResult.autoDetected) {
          warnings.push(
            `Auto-detected header row ${sheetResult.headerRow} (config had ${config.header_row_index}).`
          );
        }
      }
    } else {
      const matrix = readSpreadsheetMatrix(buffer);
      const sheetResult = parseSpreadsheetBuffer(buffer, config, matrix);
      if (sheetResult.rows.length > 0) {
        result = sheetResult;
        detectedFormat = 'spreadsheet';
        if (sheetResult.autoDetected) {
          warnings.push(
            `Auto-detected header row ${sheetResult.headerRow} (config had ${config.header_row_index}).`
          );
        }
      }
    }
  }

  const sniffedSource =
    fileSniff !== 'unknown'
      ? fileSniff
      : result && 'sniffedSource' in result
        ? result.sniffedSource
        : 'unknown';

  return {
    rawRows: result?.rows ?? [],
    detectedFormat,
    detectedHeaderRow: result?.headerRow ?? null,
    sniffedSource,
    warnings,
  };
}

// Re-export for tests that need legacy parseXlsxBuffer path
export { parseXlsxBuffer };
