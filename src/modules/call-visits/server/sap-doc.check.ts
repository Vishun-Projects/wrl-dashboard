import assert from 'node:assert/strict';
import {
  daysDiffTechSolveCons,
  matchSapDocDefective,
  matchSapDocOriginal,
  type SapDocPart,
} from '@/modules/call-visits/server/sap-doc';
import { keysFromDocsAndMaterials } from '@/modules/call-visits/server/mm-barcode';

const generationHits = [
  {
    callNo: '24B29011',
    plant: '1152',
    vendor: '307843',
    material: '2303396',
    description: 'MOTOR (D)',
    docs: '4908777159, 4908777158',
    qty: 2,
  },
  {
    callNo: '24B29011',
    plant: '1152',
    vendor: '307843',
    material: '2303393',
    description: 'COMPRESSOR (D)',
    docs: '4908652310',
    qty: 1,
  },
];

const receiptHits = [
  {
    callNo: '24B29011',
    plant: '1152',
    vendor: '307843',
    material: '2303396',
    description: 'MOTOR (D)',
    docs: '4909000001',
    qty: 5,
  },
];

const consumptionHits = [
  {
    callNo: '24B29011',
    plant: '1152',
    vendor: '307843',
    material: '1519780',
    description: 'MOTOR',
    docs: '4901000001',
    qty: 3,
    postingDate: '2026-03-10',
  },
];

function part(over: Partial<SapDocPart>): SapDocPart {
  return {
    callNo: '24B29011',
    plantName: '1152 - BANGALORE BRANCH',
    franchiseeCode: '1',
    partCategory: 'MOTOR',
    partCode: '1500002',
    ...over,
  };
}

assert.deepEqual(matchSapDocDefective(part({}), '307843', generationHits), {
  docs: '4908777158, 4908777159',
  qty: '2',
  materials: ['2303396'],
});
assert.deepEqual(
  matchSapDocDefective(part({ partCategory: 'COMPRESOR', partCode: '1500001' }), '307843', generationHits),
  { docs: '4908652310', qty: '1', materials: ['2303393'] }
);
assert.deepEqual(matchSapDocDefective(part({ partCategory: 'GAS' }), '307843', generationHits), {
  docs: null,
  qty: null,
  materials: [],
});
assert.deepEqual(matchSapDocDefective(part({}), '307843', receiptHits), {
  docs: '4909000001',
  qty: '5',
  materials: ['2303396'],
});

assert.deepEqual(matchSapDocOriginal(part({ partCode: '1519780' }), '307843', consumptionHits), {
  docs: '4901000001',
  materials: ['1519780'],
  postingDate: '2026-03-10',
});
assert.deepEqual(matchSapDocOriginal(part({ partCode: '9999999' }), '307843', consumptionHits), {
  docs: null,
  materials: [],
  postingDate: null,
});

assert.equal(daysDiffTechSolveCons('2026-03-15', '2026-03-10'), -5);
assert.equal(daysDiffTechSolveCons('2026-03-10', '2026-03-15'), 5);
assert.equal(daysDiffTechSolveCons(null, '2026-03-10'), null);

assert.deepEqual(keysFromDocsAndMaterials('4901000001', ['1519780']), [
  { doc: '4901000001', material: '1519780' },
]);
assert.deepEqual(keysFromDocsAndMaterials(null, ['1519780']), []);

console.log('sap-doc.check: ok');
