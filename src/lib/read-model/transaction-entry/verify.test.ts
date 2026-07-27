import { describe, expect, it } from 'vitest';
import { mismatchedClients, type TransactionEntryVerifyRow } from './verify';

function row(
  partial: Partial<TransactionEntryVerifyRow> & Pick<TransactionEntryVerifyRow, 'client'>
): TransactionEntryVerifyRow {
  return {
    crmCount: 0,
    mirrorCount: 0,
    mirrorNullDaddedon: 0,
    delta: 0,
    ...partial,
  };
}

describe('mismatchedClients', () => {
  it('returns empty when all clients match with no null daddedon', () => {
    expect(
      mismatchedClients([
        row({ client: 'A', crmCount: 10, mirrorCount: 10, delta: 0 }),
        row({ client: 'B', crmCount: 5, mirrorCount: 5, delta: 0 }),
      ])
    ).toEqual([]);
  });

  it('flags clients with non-zero delta', () => {
    expect(
      mismatchedClients([
        row({ client: 'ok', delta: 0 }),
        row({ client: 'short', crmCount: 100, mirrorCount: 90, delta: 10 }),
        row({ client: 'extra', crmCount: 50, mirrorCount: 52, delta: -2 }),
      ])
    ).toEqual(['short', 'extra']);
  });

  it('flags clients with null daddedon even when delta is 0', () => {
    expect(
      mismatchedClients([
        row({ client: 'dirty', delta: 0, mirrorNullDaddedon: 3 }),
        row({ client: 'clean', delta: 0, mirrorNullDaddedon: 0 }),
      ])
    ).toEqual(['dirty']);
  });
});
