import { describe, expect, it } from 'vitest';
import { collectInspectionVtrnnos } from './detail';

describe('collectInspectionVtrnnos', () => {
  it('dedupes and sorts TRNs across related failure rows', () => {
    const trns = collectInspectionVtrnnos([
      { matchedVtrnnos: ['26H26664', '26H21469'] },
      { matchedVtrnnos: ['26H21469', '26H241163'] },
      { matchedVtrnnos: null },
    ]);
    expect(trns).toEqual(['26H21469', '26H241163', '26H26664']);
  });
});

// ponytail: dedup key lives in detail.ts; this mirrors rows.ts DISTINCT ON partition
describe('failure dedup partition', () => {
  function key(ticket: string, reason: string, serial: string, callType: string) {
    return [ticket, reason, serial, callType].join('\0');
  }

  it('treats duplicate ingestions of same ticket+reason+serial+type as one attempt', () => {
    const a = key('2675652', 'Product Code Is Not Available', '42574260303150', 'BREAKDOWN');
    const b = key('2675652', 'Product Code Is Not Available', '42574260303150', 'BREAKDOWN');
    const c = key('2676753', 'Call is Already Open', '42574260303150', 'BREAKDOWN');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
