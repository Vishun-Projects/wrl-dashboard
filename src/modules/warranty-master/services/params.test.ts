import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseWarrantyMasterParams, warrantyMasterParamsToSearchParams } from './params';

describe('warranty-master soldTo params', () => {
  it('parses and round-trips soldTo', () => {
    const qs = new URLSearchParams('soldTo=Acme%20Ltd,Beta%20Co&customer=Sub1');
    const parsed = parseWarrantyMasterParams(qs);
    assert.equal(parsed.soldTo, 'Acme Ltd,Beta Co');
    assert.equal(parsed.customer, 'Sub1');
    const back = warrantyMasterParamsToSearchParams(parsed);
    assert.equal(back.get('soldTo'), 'Acme Ltd,Beta Co');
    assert.equal(back.get('customer'), 'Sub1');
  });
});
