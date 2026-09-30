import assert from 'node:assert/strict';
import {
  pickRateCardUnit,
  rateCardExpectedTotal,
  rateCardVariance,
  transformRateCardCrmRow,
  type ArcpRateCardHotRow,
} from './rate-card';

const sampleCards: ArcpRateCardHotRow[] = [
  {
    ncode: 1,
    noffice: 24,
    nofficeid: 1,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: '6',
    ncalltype: null,
    nclient: null,
    ntraveltype: null,
    ntat_from: 0,
    ntat_to: 48,
    nchargespayable: 1700,
    nchargesreceivable: null,
  },
  {
    ncode: 2,
    noffice: 24,
    nofficeid: 1,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: null,
    ncalltype: null,
    nclient: null,
    ntraveltype: null,
    ntat_from: 0,
    ntat_to: 48,
    nchargespayable: 500,
    nchargesreceivable: null,
  },
  {
    ncode: 3,
    noffice: 99,
    nofficeid: 1,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: null,
    ncalltype: null,
    nclient: null,
    ntraveltype: null,
    ntat_from: 0,
    ntat_to: 48,
    nchargespayable: 200,
    nchargesreceivable: null,
  },
];

assert.equal(
  pickRateCardUnit(sampleCards, {
    nofficeid: 144,
    office_under: 24,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: null,
    ntat: 12,
  }),
  500,
  'minor → blank repair rate'
);
assert.equal(
  pickRateCardUnit(sampleCards, {
    nofficeid: 144,
    office_under: 24,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: '6',
    ntat: 12,
  }),
  1700,
  'Gas Charging Done → major rate'
);
assert.equal(
  pickRateCardUnit(sampleCards, {
    nofficeid: 144,
    office_under: 24,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: '5',
    ntat: 12,
  }),
  500,
  'other repair codes stay on minor rate'
);
assert.equal(
  pickRateCardUnit(sampleCards, {
    nofficeid: 500,
    office_under: 99,
    nitemcategory: '10',
    nlocalupcountry: '1',
    nrepairtype: null,
    ntat: 10,
  }),
  200,
  'other branch'
);

assert.equal(rateCardExpectedTotal(200, 4), 800);
assert.equal(rateCardVariance(800, 800), 0);

const transformed = transformRateCardCrmRow({
  ncode: '42',
  noffice: '24',
  nofficeid: '1',
  nitemcategory: '10',
  nlocalupcountry: '1',
  nrepairtype: '6',
  nTATFrom: '0',
  nTATTo: '48',
  nchargespayable: '1,700.00',
});
assert.equal(transformed?.noffice, 24);
assert.equal(transformed?.nchargespayable, 1700);

console.log('arcp-provision rate-card check ok');
