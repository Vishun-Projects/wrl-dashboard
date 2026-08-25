import { describe, expect, it } from 'vitest';
import { evaluateAthenaCallMatch, extractServiceOrderNo } from './reconcile';

describe('Athena Multi-Tier Reconciliation Logic', () => {
  const baseFailedCall = {
    callType: 'Breakdown',
    outletName: 'Metro Store Delhi',
    serialNo: 'WRL987654',
    callDate: new Date('2025-02-10T10:00:00Z'),
    isValidMatchingData: true,
  };

  it('extracts service order number from Athena failure message', () => {
    expect(
      extractServiceOrderNo('Call is Already Open. Service Order No. is 26H07471')
    ).toBe('26H07471');
    expect(
      extractServiceOrderNo('Call is Already Open. Call No. is 25H26001')
    ).toBe('25H26001');
    expect(extractServiceOrderNo('Product Code Is Not Available')).toBeNull();
  });

  it('matches CRM call via direct Service Order No extracted from failure reason', () => {
    const failedCall = {
      ...baseFailedCall,
      resultValue: 'Call is Already Open. Service Order No. is 26H07471',
    };
    const candidateCalls = [
      {
        vtrnno: '26H07471',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-05T10:00:00Z'),
        statusLabel: 'Open Unallocated',
      },
    ];

    const result = evaluateAthenaCallMatch(failedCall, candidateCalls);
    expect(result.status).toBe('REGISTERED');
    expect(result.matchCount).toBe(1);
    expect(result.matchedVtrnno).toBe('26H07471');
  });

  it('matches CRM call via CCLID / Client Ticket No', () => {
    const failedCall = {
      ...baseFailedCall,
      clientTicketNo: '2667215',
      resultValue: 'CCLID Already Exist',
    };
    const candidateCalls = [
      {
        vtrnno: '26H01234',
        vcclid: '2667215',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-08T10:00:00Z'),
        statusLabel: 'Closed',
      },
    ];

    const result = evaluateAthenaCallMatch(failedCall, candidateCalls);
    expect(result.status).toBe('REGISTERED');
    expect(result.matchedVtrnno).toBe('26H01234');
  });

  it('matches single registered CRM call when all 4 standard criteria are met', () => {
    const candidateCalls = [
      {
        vtrnno: 'TRN-2025-001',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-10T14:30:00Z'), // >= callDate
        statusLabel: 'Closed',
      },
    ];

    const result = evaluateAthenaCallMatch(baseFailedCall, candidateCalls);
    expect(result.status).toBe('REGISTERED');
    expect(result.matchCount).toBe(1);
    expect(result.matchedVtrnno).toBe('TRN-2025-001');
    expect(result.matchedVtrnnos).toEqual(['TRN-2025-001']);
  });

  it('returns NOT_REGISTERED when no CRM calls match', () => {
    const candidateCalls = [
      {
        vtrnno: 'TRN-2025-002',
        callType: 'Installation', // different type
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-10T14:30:00Z'),
      },
      {
        vtrnno: 'TRN-2025-003',
        callType: 'Breakdown',
        partyName: 'Other Store', // different outlet
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-10T14:30:00Z'),
      },
      {
        vtrnno: 'TRN-2025-004',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'DIFFERENT_SN', // different serial
        loggedAt: new Date('2025-02-10T14:30:00Z'),
      },
    ];

    const result = evaluateAthenaCallMatch(baseFailedCall, candidateCalls);
    expect(result.status).toBe('NOT_REGISTERED');
    expect(result.matchCount).toBe(0);
    expect(result.matchedVtrnno).toBeNull();
  });

  it('does NOT match standard CRM calls logged BEFORE the failed call date unless via order/cclid', () => {
    const candidateCalls = [
      {
        vtrnno: 'TRN-2025-005',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-09T09:00:00Z'), // Prior date!
      },
    ];

    const result = evaluateAthenaCallMatch(baseFailedCall, candidateCalls);
    expect(result.status).toBe('NOT_REGISTERED');
    expect(result.matchCount).toBe(0);
  });

  it('flags MULTIPLE_MATCHES when more than one CRM call matches standard criteria', () => {
    const candidateCalls = [
      {
        vtrnno: 'TRN-2025-010',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-10T12:00:00Z'),
      },
      {
        vtrnno: 'TRN-2025-011',
        callType: 'Breakdown',
        partyName: 'Metro Store Delhi',
        serial: 'WRL987654',
        loggedAt: new Date('2025-02-11T09:00:00Z'),
      },
    ];

    const result = evaluateAthenaCallMatch(baseFailedCall, candidateCalls);
    expect(result.status).toBe('MULTIPLE_MATCHES');
    expect(result.matchCount).toBe(2);
    expect(result.matchedVtrnnos).toEqual(['TRN-2025-010', 'TRN-2025-011']);
  });

  it('returns INVALID_DATA when required matching fields are invalid', () => {
    const invalidFailedCall = {
      ...baseFailedCall,
      isValidMatchingData: false,
    };

    const result = evaluateAthenaCallMatch(invalidFailedCall, []);
    expect(result.status).toBe('INVALID_DATA');
  });
});
