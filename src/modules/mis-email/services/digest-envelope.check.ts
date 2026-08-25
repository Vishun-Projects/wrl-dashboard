import assert from 'node:assert/strict';
import { digestEnvelopeRecipients } from '@/modules/mis-email/services/run-digest';

assert.deepEqual(
  digestEnvelopeRecipients(
    ['A@Example.com', 'b@example.com'],
    ['b@example.com', 'c@example.com', 'mis.service@westernequipments.com']
  ),
  ['a@example.com', 'b@example.com', 'c@example.com', 'mis.service@westernequipments.com']
);

console.log('digestEnvelopeRecipients ok');
