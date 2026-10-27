import assert from 'node:assert/strict';
import { keysFromDocsAndMaterials } from '@/modules/call-visits/server/mm-barcode';

assert.deepEqual(keysFromDocsAndMaterials('4901, 4902', ['001519780', '2303396']), [
  { doc: '4901', material: '1519780' },
  { doc: '4901', material: '2303396' },
  { doc: '4902', material: '1519780' },
  { doc: '4902', material: '2303396' },
]);

/** Mismatch rules: SAP set present + CRM blank or not in set. */
function mismatch(crm: string | null, sap: string | null): boolean {
  if (!sap?.trim()) return false;
  const set = new Set(
    sap
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
  if (set.size === 0) return false;
  const c = (crm ?? '').trim().toUpperCase();
  if (!c) return true;
  return !set.has(c);
}

assert.equal(mismatch('ABC', 'ABC, DEF'), false);
assert.equal(mismatch('abc', 'ABC, DEF'), false);
assert.equal(mismatch('ZZZ', 'ABC, DEF'), true);
assert.equal(mismatch('', 'ABC'), true);
assert.equal(mismatch('ABC', null), false);
assert.equal(mismatch('ABC', ''), false);

console.log('mm-barcode.check: ok');
