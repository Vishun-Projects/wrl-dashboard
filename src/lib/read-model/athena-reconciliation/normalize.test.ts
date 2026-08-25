import { describe, expect, it } from 'vitest';
import {
  cleanText,
  computeAthenaRawFingerprint,
  normalizeAthenaFailedRow,
  normalizeKey,
  normalizeSerial,
  parseAthenaDate,
  resolveBranchName,
} from './normalize';

describe('Athena normalization & parsing', () => {
  it('cleans text and normalizes keys', () => {
    expect(cleanText('  Hello   World  \t\n')).toBe('Hello World');
    expect(cleanText('')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(normalizeKey('  breakdown call  ')).toBe('BREAKDOWN CALL');
  });

  it('resolves branch code to clean branch name', () => {
    expect(resolveBranchName('1159')).toBe('CHENNAI');
    expect(resolveBranchName('1173')).toBe('DELHI');
    expect(resolveBranchName('1162')).toBe('HYDERABAD');
    expect(resolveBranchName('1157 - COCHIN BRANCH')).toBe('COCHIN');
    expect(resolveBranchName('Custom Branch')).toBe('Custom');
    expect(resolveBranchName(null)).toBeNull();
  });

  it('normalizes serial numbers accurately', () => {
    expect(normalizeSerial('  WRL 123 456  ')).toBe('WRL123456');
    expect(normalizeSerial('sn-98765-xyz')).toBe('SN-98765-XYZ');
    expect(normalizeSerial(null)).toBe('');
  });

  it('parses Indian date format DD/MM/YYYY and standard timestamps', () => {
    const d1 = parseAthenaDate('25/12/2024');
    expect(d1).not.toBeNull();
    expect(d1?.getFullYear()).toBe(2024);
    expect(d1?.getMonth()).toBe(11); // December is month 11
    expect(d1?.getDate()).toBe(25);

    const d2 = parseAthenaDate('05/03/2025 14:30:00');
    expect(d2).not.toBeNull();
    expect(d2?.getHours()).toBe(14);
    expect(d2?.getMinutes()).toBe(30);

    const d3 = parseAthenaDate('2025-01-15T10:00:00Z');
    expect(d3).not.toBeNull();
    expect(d3?.toISOString()).toContain('2025-01-15');
  });

  it('generates consistent raw fingerprints for idempotency', () => {
    const raw1 = {
      CLIENTTICKETNO: 'TCK-001',
      SERIALNO: 'SER123',
      RECEIVEDDATE: '01/01/2025',
      OUTLETNAME: 'Outlet A',
      CALLTYPE: 'Breakdown',
      RESULT_VALUE: 'Serial not found',
      addedon: '01/01/2025 10:00:00',
    };
    const raw2 = {
      CLIENTTICKETNO: 'TCK-001',
      SERIALNO: '  ser123  ',
      RECEIVEDDATE: '01/01/2025',
      OUTLETNAME: 'Outlet A',
      CALLTYPE: 'Breakdown',
      RESULT_VALUE: 'Serial not found',
      addedon: '01/01/2025 10:00:00',
    };
    expect(computeAthenaRawFingerprint(raw1)).toBe(computeAthenaRawFingerprint(raw2));
  });

  it('validates mandatory matching fields and flags INVALID_DATA when missing', () => {
    const invalidRaw = {
      CLIENTTICKETNO: 'TCK-002',
      SERIALNO: '', // missing serial
      RECEIVEDDATE: '01/01/2025',
      OUTLETNAME: 'Outlet B',
      CALLTYPE: 'Breakdown',
      RESULT_VALUE: 'Error',
    };
    const norm = normalizeAthenaFailedRow(1, invalidRaw, 'fp-1');
    expect(norm.isValidMatchingData).toBe(false);
    expect(norm.reconciliationStatus).toBe('INVALID_DATA');
    expect(norm.invalidReason).toContain('SERIALNO');
  });

  it('correctly marks valid data as NOT_REGISTERED initially and resolves branch and client', () => {
    const validRaw = {
      CLIENTTICKETNO: 'TCK-003',
      SERIALNO: 'SR-999',
      RECEIVEDDATE: '05/02/2025',
      OUTLETNAME: 'Corner Store',
      CALLTYPE: 'Installation',
      RESULT_VALUE: 'Model mismatch',
      BRANCHNAME: '1159',
      CLIENT: 'Nestle',
    };
    const norm = normalizeAthenaFailedRow(2, validRaw, 'fp-2');
    expect(norm.isValidMatchingData).toBe(true);
    expect(norm.reconciliationStatus).toBe('NOT_REGISTERED');
    expect(norm.invalidReason).toBeNull();
    expect(norm.failureReason).toBe('Model mismatch');
    expect(norm.branchName).toBe('CHENNAI');
    expect(norm.clientCaption).toBe('Nestle');
  });
});
