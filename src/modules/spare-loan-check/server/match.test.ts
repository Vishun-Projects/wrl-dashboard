import { describe, expect, it } from 'vitest';
import {
  classifySpareLoanRow,
  isCallLikeSo,
  selectMatchKey,
  vendorsMatch,
} from '@/modules/spare-loan-check/server/match';
import type { SpareLoanCallLookup } from '@/modules/spare-loan-check/types';

function call(partial: Partial<SpareLoanCallLookup>): SpareLoanCallLookup {
  return {
    vtrnno: '25B22681',
    vendorCode: '300364',
    statusBucket: 'closed',
    ncancelreason: 0,
    cancelReason: null,
    transferred: false,
    ...partial,
  };
}

describe('selectMatchKey', () => {
  it('prefers call-like loan SO', () => {
    expect(selectMatchKey('25B22681', '25A00001')).toEqual({
      key: '25B22681',
      source: 'loan',
    });
  });

  it('falls back to Con/Rtn when loan is a name or Buffer', () => {
    expect(selectMatchKey('Buffer', '25A171080')).toEqual({
      key: '25A171080',
      source: 'con_rtn',
    });
    expect(selectMatchKey('Karthik', '24H14494')).toEqual({
      key: '24H14494',
      source: 'con_rtn',
    });
  });

  it('falls back to Con/Rtn when loan is empty', () => {
    expect(selectMatchKey('', '25D10700')).toEqual({
      key: '25D10700',
      source: 'con_rtn',
    });
  });

  it('skips when both empty', () => {
    expect(selectMatchKey('', '')).toBeNull();
  });

  it('skips when loan is junk and Con/Rtn empty', () => {
    expect(selectMatchKey('AMC Buffer', '')).toBeNull();
  });
});

describe('isCallLikeSo', () => {
  it('accepts typical vtrnno shapes', () => {
    expect(isCallLikeSo('25B22681')).toBe(true);
    expect(isCallLikeSo('24L283315')).toBe(true);
  });

  it('rejects names', () => {
    expect(isCallLikeSo('Buffer')).toBe(false);
    expect(isCallLikeSo('mohan')).toBe(false);
  });
});

describe('vendorsMatch', () => {
  it('matches normalized vendor codes', () => {
    expect(vendorsMatch('300364', '300364')).toBe(true);
    expect(vendorsMatch('300364-BLK', '300364')).toBe(true);
  });

  it('rejects different vendors', () => {
    expect(vendorsMatch('300364', '305594')).toBe(false);
  });
});

describe('classifySpareLoanRow', () => {
  it('hides clean match', () => {
    expect(classifySpareLoanRow('300364', call({}))).toBeNull();
  });

  it('hides not_found', () => {
    expect(classifySpareLoanRow('300364', undefined)).toBeNull();
  });

  it('flags vendor_mismatch', () => {
    expect(classifySpareLoanRow('305594', call({ vendorCode: '300364' }))).toBe('vendor_mismatch');
  });

  it('flags cancelled even when vendor matches', () => {
    expect(
      classifySpareLoanRow(
        '300364',
        call({ statusBucket: 'cancelled', ncancelreason: 9, cancelReason: 'Wrong Call' })
      )
    ).toBe('cancelled');
  });

  it('treats transferred as vendor_mismatch', () => {
    expect(classifySpareLoanRow('300364', call({ transferred: true, ncancelreason: 2 }))).toBe(
      'vendor_mismatch'
    );
  });

  it('prefers cancelled over vendor_mismatch', () => {
    expect(
      classifySpareLoanRow(
        '999999',
        call({ statusBucket: 'cancelled', ncancelreason: 5, vendorCode: '300364' })
      )
    ).toBe('cancelled');
  });
});
