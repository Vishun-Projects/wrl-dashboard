import { describe, expect, it } from 'vitest';
import { movementRowKey } from '@/modules/spare-stock-analysis/parse-mb51';

describe('MB51 row key', () => {
  it('is SHA-256 hex, not a pipe-joined payload', async () => {
    const key = await movementRowKey({
      plant: '1158',
      matDoc: '4900048120',
      matYr: '2025',
      material: '1500170',
      mvt: '561',
      postingDate: '2025-01-31',
      qty: 1,
      location: 'S200',
      supplier: '',
      callNo: '',
      entryDate: '2025-02-02',
      entryTime: '05:24:29',
      batch: '',
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key.includes('|')).toBe(false);
  });
});
