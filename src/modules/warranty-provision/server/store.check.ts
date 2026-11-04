/**
 *   npx tsx src/modules/warranty-provision/server/store.check.ts
 */
import assert from 'node:assert/strict';
import { remainingDays, warrantyStatus } from '../fy';

assert.equal(remainingDays('2025-06-02', '2025-06-01'), 1);
assert.equal(warrantyStatus('2025-06-02', '2025-06-02'), 'Inactive');
console.log('warranty-provision store check: ok');
