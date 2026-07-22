/**
 * Mutually exclusive open-call aging buckets (as-of aging date).
 * Each open call falls in exactly one bucket; the four counts sum to total open calls.
 *
 * Buckets: ≤2 days | 3–7 days | 8–15 days | >15 days
 */

export type AgingBucketFields = {
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
};

export function openCallsFromAging(m: AgingBucketFields): number {
  return m.age_2 + m.age_3 + m.age_7 + m.age_15;
}

/** $1 = aging as-of date; uses logged_at date on the hot row. */
export const AGING_BUCKET_SQL = `
  SUM(CASE WHEN ($1::date - h.logged_at::date) <= 2 THEN 1 ELSE 0 END)::int AS age_2,
  SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 3 AND 7 THEN 1 ELSE 0 END)::int AS age_3,
  SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 8 AND 15 THEN 1 ELSE 0 END)::int AS age_7,
  SUM(CASE WHEN ($1::date - h.logged_at::date) > 15 THEN 1 ELSE 0 END)::int AS age_15
`.trim();

export function assignAgingBucket(dayDiff: number): keyof AgingBucketFields {
  if (dayDiff <= 2) return 'age_2';
  if (dayDiff <= 7) return 'age_3';
  if (dayDiff <= 15) return 'age_7';
  return 'age_15';
}

export function incrementAgingBucket(
  target: AgingBucketFields,
  dayDiff: number
): void {
  target[assignAgingBucket(dayDiff)] += 1;
}
