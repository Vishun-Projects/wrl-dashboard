import { describe, expect, it } from 'vitest';
import { buildStoreZip } from '@/modules/spare-loan-check/zip-store';
import { branchFileLabel, safeFilePart } from '@/modules/spare-loan-check/export-labels';

describe('safeFilePart / branchFileLabel', () => {
  it('keeps code and branch name together', () => {
    expect(branchFileLabel('1152', '1152 - BANGALORE BRANCH')).toBe('1152 - BANGALORE BRANCH');
    expect(branchFileLabel('1150', 'RANCHI BRANCH')).toBe('1150 - RANCHI BRANCH');
    expect(branchFileLabel('1133', null)).toBe('1133');
    expect(safeFilePart('1152 - BANGALORE BRANCH')).toBe('1152_-_BANGALORE_BRANCH');
    expect(safeFilePart('SOUTH ZONE')).toBe('SOUTH_ZONE');
  });
});

describe('buildStoreZip', () => {
  it('builds a zip with PK signatures', async () => {
    const blob = buildStoreZip([{ name: 'a.csv', content: 'x,y\n1,2\n' }]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    expect(blob.size).toBeGreaterThan(30);
  });
});
