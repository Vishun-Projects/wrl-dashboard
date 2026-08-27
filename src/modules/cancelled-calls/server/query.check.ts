import { istYesterdayYmd } from './query';

// ponytail: assert-based self-check — run via vitest or `npx tsx`
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const sample = new Date('2026-08-26T10:00:00+05:30');
assert(istYesterdayYmd(sample) === '2026-08-25', 'IST yesterday from 26 Aug IST morning');

const nearMidnight = new Date('2026-08-26T00:30:00+05:30');
assert(istYesterdayYmd(nearMidnight) === '2026-08-25', 'IST yesterday near midnight');

console.log('cancelled-calls date check ok');
