/**
 * Runnable check: pg date mapping for warranty provision.
 *   npx tsx src/modules/warranty-provision/server/store.check.ts
 */
import assert from 'node:assert/strict';

/** Mirror store.ts pgDate — pg DATE as local midnight must not use toISOString. */
function pgDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Local midnight 4 Jun 2019 (IST) — broken String(date).slice yields "Tue Jun 0" / year 2001 in UI.
const local = new Date(2019, 5, 4);
assert.equal(pgDate(local), '2019-06-04');
assert.notEqual(String(local).slice(0, 10), '2019-06-04');
assert.equal(pgDate('2019-06-04T18:30:00.000Z'), '2019-06-04');
assert.equal(pgDate(null), null);

console.log('warranty-provision store check: ok');
