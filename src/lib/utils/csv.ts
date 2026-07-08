/** Escape a single cell for CSV (RFC-style quoting). */
export function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type CsvRecordCounter = {
  inQuotes: boolean;
  headerDone: boolean;
  rowCount: number;
  carry: string;
};

export function createCsvRecordCounter(): CsvRecordCounter {
  return { inQuotes: false, headerDone: false, rowCount: 0, carry: '' };
}

function finishCsvRecord(counter: CsvRecordCounter, record: string): void {
  if (record.replace(/\r/g, '').trim().length === 0) return;
  if (!counter.headerDone) {
    counter.headerDone = true;
    return;
  }
  counter.rowCount += 1;
}

/** Incrementally count RFC4180 CSV data rows (skips header) across streamed chunks. */
export function feedCsvRecordCounter(counter: CsvRecordCounter, chunk: string): void {
  const text = counter.carry + chunk;
  counter.carry = '';
  let recordStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (counter.inQuotes && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      counter.inQuotes = !counter.inQuotes;
      continue;
    }

    if (!counter.inQuotes && (ch === '\n' || ch === '\r')) {
      finishCsvRecord(counter, text.slice(recordStart, i));
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      recordStart = i + 1;
    }
  }

  if (recordStart < text.length) {
    counter.carry = text.slice(recordStart);
    // Opening quote was already consumed before the chunk boundary.
    if (counter.inQuotes && counter.carry.startsWith('"')) {
      counter.carry = counter.carry.slice(1);
    }
  }
}

export function finalizeCsvRecordCounter(counter: CsvRecordCounter): number {
  if (counter.carry.replace(/\r/g, '').trim().length > 0) {
    finishCsvRecord(counter, counter.carry);
    counter.carry = '';
  }
  return counter.rowCount;
}
