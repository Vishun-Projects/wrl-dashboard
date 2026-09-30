import assert from 'node:assert/strict';
import {
  listActiveMaterials,
  listRepairMaster,
  loadItemCategoryLabelsByCode,
  lookupItemCategoriesByMaterial,
  normalizeMaterialCode,
  refreshCrmMasters,
} from '@/lib/read-model/crm-masters';

assert.equal(typeof refreshCrmMasters, 'function');
assert.equal(typeof lookupItemCategoriesByMaterial, 'function');
assert.equal(typeof listRepairMaster, 'function');
assert.equal(typeof listActiveMaterials, 'function');
assert.equal(typeof loadItemCategoryLabelsByCode, 'function');
assert.equal(normalizeMaterialCode('01528318'), '1528318');
assert.equal(normalizeMaterialCode('  01528318  '), '1528318');
console.log('crm-masters.check: ok');
