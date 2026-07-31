import assert from 'node:assert/strict';

/** Mirrors parent-key preference in call-by-id route (ncode wins over TRN). */
function resolveParentCondition(id: string, vtrnno: string | null): string {
  const isNumericId = /^\d+$/.test(id);
  const safeId = id.replace(/'/g, "''");
  const safeTrn = (vtrnno ?? '').trim().replace(/'/g, "''");
  if (isNumericId) return `tc.ncode = '${safeId}'`;
  if (safeTrn) return `(tc.vtrnno = '${safeTrn}' OR tc.vtransfercallno = '${safeTrn}')`;
  return `(tc.vtrnno = '${safeId}' OR tc.vtransfercallno = '${safeId}')`;
}

assert.equal(resolveParentCondition('12345', '26G25805'), "tc.ncode = '12345'");
assert.match(resolveParentCondition('26G25805', '26G25805'), /vtrnno/);
assert.match(resolveParentCondition('26G25805', null), /vtrnno/);
console.log('call-by-id parent condition check ok');
