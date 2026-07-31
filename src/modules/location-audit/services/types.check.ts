import assert from 'node:assert/strict';
import {
  LOCATION_AUDIT_MAX_ROWS,
  clampLocationAuditLimit,
} from '@/modules/location-audit/services/types';

assert.equal(LOCATION_AUDIT_MAX_ROWS, 2000);
assert.equal(clampLocationAuditLimit(undefined), 2000);
assert.equal(clampLocationAuditLimit(Number.NaN), 2000);
assert.equal(clampLocationAuditLimit(500), 500);
assert.equal(clampLocationAuditLimit(99999), 2000);
console.log('location-audit limit clamp check ok');
