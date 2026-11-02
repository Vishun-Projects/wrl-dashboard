import { describe, expect, it } from 'vitest';
import { buildRejectedCallsCsv, rejectedCallToCsvLine } from './csv';
import type { RejectedCallRow } from '../types';

const row: RejectedCallRow = {
  ncode: 1,
  nofficeid: 10,
  callNo: '12345',
  callDate: '2026-03-15',
  serialNo: 'SN,1',
  callType: 'Breakdown',
  activityDone: null,
  solveDate: null,
  rejectedBySource: 'HO',
  rejectionAt: '2026-03-16T10:30:00',
  rejectionReason: 'Need "photo"',
  rejectedByName: 'Ada',
  branchName: 'Mumbai',
  franchiseeName: null,
};

describe('rejected-calls csv', () => {
  it('escapes quotes/commas and formats dates', () => {
    const line = rejectedCallToCsvLine(row);
    // excelTextFormula + escapeCsvCell → Excel text formula in a quoted cell
    expect(line).toContain('"=""12345"""');
    expect(line).toContain('"=""SN,1"""');
    expect(line).toContain('Need ""photo""');
    expect(line).toContain('15.03.2026');
    expect(line).toContain('HO');
  });

  it('includes header row', () => {
    const csv = buildRejectedCallsCsv([row]);
    expect(csv.startsWith('Call No,Call Date,')).toBe(true);
    expect(csv.split('\n')).toHaveLength(2);
  });
});
