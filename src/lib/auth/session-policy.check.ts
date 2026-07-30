import assert from 'node:assert/strict';
import {
  SESSION_MAX_AGE_SEC,
  isSessionExpired,
  parseSessionStartedAt,
  sessionExpiresAtSec,
} from './session-policy';

const started = 1_700_000_000;

assert.equal(SESSION_MAX_AGE_SEC, 3 * 24 * 60 * 60);
assert.equal(isSessionExpired(null), true);
assert.equal(isSessionExpired(undefined), true);
assert.equal(isSessionExpired(0), true);
assert.equal(isSessionExpired(started, started), false);
assert.equal(isSessionExpired(started, started + SESSION_MAX_AGE_SEC - 1), false);
assert.equal(isSessionExpired(started, started + SESSION_MAX_AGE_SEC), true);
assert.equal(isSessionExpired(started, started + SESSION_MAX_AGE_SEC + 1), true);
assert.equal(sessionExpiresAtSec(started), started + SESSION_MAX_AGE_SEC);
assert.equal(parseSessionStartedAt('1700000000'), 1_700_000_000);
assert.equal(parseSessionStartedAt(''), null);
assert.equal(parseSessionStartedAt('nope'), null);

console.log('session-policy ok');
