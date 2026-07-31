import * as XLSX from 'xlsx';

export async function parseXlsxBuffer(
  buffer: Buffer,
  headerRowIndex: number
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  const headerRow = matrix[headerRowIndex - 1] ?? [];
  const headerEntries: { name: string; index: number }[] = [];
  headerRow.forEach((cell, index) => {
    const name = String(cell ?? '').trim();
    if (name) headerEntries.push({ name, index });
  });
  const headers = headerEntries.map((entry) => entry.name);
  const rows: Record<string, string>[] = [];

  for (let r = headerRowIndex; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const record: Record<string, string> = {};
    let hasValue = false;

    for (const { name, index } of headerEntries) {
      const value = String(line[index] ?? '').trim();
      if (value) hasValue = true;
      record[name] = value;
    }

    if (hasValue) rows.push(record);
  }

  return { headers, rows };
}

/** Parse rows from an already-loaded sheet matrix (avoids re-reading the workbook). */
export function parseSpreadsheetMatrix(
  matrix: (string | number | Date | null)[][],
  headerRowIndex: number
): { headers: string[]; rows: Record<string, string>[] } {
  const headerRow = matrix[headerRowIndex - 1] ?? [];
  const headerEntries: { name: string; index: number }[] = [];
  headerRow.forEach((cell, index) => {
    const name = String(cell ?? '').trim();
    if (name) headerEntries.push({ name, index });
  });
  const headers = headerEntries.map((entry) => entry.name);
  const rows: Record<string, string>[] = [];

  for (let r = headerRowIndex; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const record: Record<string, string> = {};
    let hasValue = false;

    for (const { name, index } of headerEntries) {
      const value = String(line[index] ?? '').trim();
      if (value) hasValue = true;
      record[name] = value;
    }

    if (hasValue) rows.push(record);
  }

  return { headers, rows };
}
