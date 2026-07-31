import assert from 'node:assert/strict';
import { resolvePersonalDigestTargets } from './preferences';

const self = resolvePersonalDigestTargets({}, 'me@westernequipments.com');
assert.deepEqual(self.to, ['me@westernequipments.com']);
assert.deepEqual(self.cc, []);

const explicit = resolvePersonalDigestTargets(
  {
    toEmails: ['a@westernequipments.com', 'b@westernequipments.com'],
    ccEmails: ['c@westernequipments.com', 'a@westernequipments.com'],
  },
  'me@westernequipments.com'
);
assert.deepEqual(explicit.to, ['a@westernequipments.com', 'b@westernequipments.com']);
assert.deepEqual(explicit.cc, ['c@westernequipments.com']);

const emptyTo = resolvePersonalDigestTargets({ toEmails: [] }, 'me@westernequipments.com');
assert.deepEqual(emptyTo.to, []);

console.log('resolvePersonalDigestTargets ok');
