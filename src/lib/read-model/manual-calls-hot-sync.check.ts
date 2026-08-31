import assert from 'node:assert/strict';
import { formatLocalDate } from '@/lib/dates/local-date';

function subtractDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}

assert.equal(subtractDays('2026-08-31', 6), '2026-08-25');

console.log('manual-calls-hot-sync ok');
