import assert from 'node:assert/strict';
import {
  classifyRegisterRowStatus,
  isRegisterRowTransferred,
} from '@/lib/call/status/register-row';

// 26I221063-shaped: Wrong Call cancel with leftover rebook vtransfercallno
assert.equal(
  isRegisterRowTransferred({
    ncancelreason: 9,
    vtransfercallno: '24C09037',
  }),
  false
);
assert.equal(
  classifyRegisterRowStatus({
    ncancelreason: 9,
    cancel_reason: 'Wrong Call',
    callstatus: 'Cancel',
    vtransfercallno: '24C09037',
    bsolved: false,
    bfastclose: false,
  }),
  'cancelled'
);

assert.equal(
  isRegisterRowTransferred({ ncancelreason: 2, vtransfercallno: 'x' }),
  true
);
assert.equal(
  isRegisterRowTransferred({ ncancelreason: 0, vtransfercallno: 'x' }),
  true
);

console.log('register-row transfer/cancel ok');
