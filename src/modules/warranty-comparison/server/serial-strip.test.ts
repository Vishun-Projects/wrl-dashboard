import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildWarrantyStripBySerialsSql, WARRANTY_MONTHS_SQL } from './serial-strip';

describe('warranty serial strip SQL', () => {
  it('looks up master warranty and latest CRM account by serial', () => {
    const sql = buildWarrantyStripBySerialsSql();
    expect(sql).toContain('warranty_master_items');
    expect(sql).toContain('calls_latest_hot');
    expect(sql).toContain(WARRANTY_MONTHS_SQL);
    expect(sql).toContain('customer_subgroup');
    expect(sql).toContain('fg_model');
    expect(sql).toContain('billing_doc');
    expect(sql).toContain('unnest($1::text[])');
    expect(sql).toContain('serial = s.raw');
    expect(sql).not.toContain('UPPER(BTRIM(serial))');
  });
});
