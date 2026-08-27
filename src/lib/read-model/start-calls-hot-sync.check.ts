import assert from 'node:assert/strict';
import { istYesterdayYmd } from './start-calls-hot-sync';

const fixed = new Date('2026-08-27T10:00:00+05:30');
assert.equal(istYesterdayYmd(fixed), '2026-08-26');

console.log('start-calls-hot-sync ok');
