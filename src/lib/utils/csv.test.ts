import { describe, expect, it } from 'vitest';
import {
  createCsvRecordCounter,
  escapeCsvCell,
  feedCsvRecordCounter,
  finalizeCsvRecordCounter,
} from '@/lib/utils/csv';

function countCsvDataRows(text: string): number {
  const counter = createCsvRecordCounter();
  feedCsvRecordCounter(counter, text);
  return finalizeCsvRecordCounter(counter);
}

function countCsvDataRowsInChunks(chunks: string[]): number {
  const counter = createCsvRecordCounter();
  for (const chunk of chunks) {
    feedCsvRecordCounter(counter, chunk);
  }
  return finalizeCsvRecordCounter(counter);
}

describe('escapeCsvCell', () => {
  it('quotes fields with embedded newlines', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('csv record counter', () => {
  it('counts data rows and skips the header', () => {
    const csv = 'ID,Name\r\n1,Alpha\r\n2,Beta\r\n3,Gamma\r\n';
    expect(countCsvDataRows(csv)).toBe(3);
  });

  it('does not treat embedded newlines inside quotes as extra rows', () => {
    const csv =
      'Complaint,Address\r\n' +
      `${escapeCsvCell('Door broken\nHandle loose')},${escapeCsvCell('12 Main St\nBlock A')}\r\n` +
      'Minor issue,Flat 9\r\n';
    expect(countCsvDataRows(csv)).toBe(2);
  });

  it('handles streamed chunks that split inside quoted fields', () => {
    const row =
      `${escapeCsvCell('Door broken\nHandle loose')},${escapeCsvCell('12 Main St\nBlock A')}\r\n`;
    const csv = `Complaint,Address\r\n${row}Minor issue,Flat 9\r\n`;
    const splitAt = csv.indexOf('Handle');
    const chunks = [csv.slice(0, splitAt), csv.slice(splitAt)];
    expect(countCsvDataRowsInChunks(chunks)).toBe(2);
  });
});
