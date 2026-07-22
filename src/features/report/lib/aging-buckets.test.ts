import { describe, expect, it } from 'vitest';
import {
  assignAgingBucket,
  incrementAgingBucket,
  openCallsFromAging,
} from '@/features/report/lib/aging-buckets';

describe('aging-buckets', () => {
  it('assigns each day diff to exactly one bucket', () => {
    expect(assignAgingBucket(0)).toBe('age_2');
    expect(assignAgingBucket(2)).toBe('age_2');
    expect(assignAgingBucket(3)).toBe('age_3');
    expect(assignAgingBucket(7)).toBe('age_3');
    expect(assignAgingBucket(8)).toBe('age_7');
    expect(assignAgingBucket(15)).toBe('age_7');
    expect(assignAgingBucket(16)).toBe('age_15');
  });

  it('sums aging buckets to open calls', () => {
    const buckets = { age_2: 0, age_3: 0, age_7: 0, age_15: 0 };
    for (const day of [0, 1, 5, 10, 20, 30]) {
      incrementAgingBucket(buckets, day);
    }
    expect(openCallsFromAging(buckets)).toBe(6);
    expect(buckets).toEqual({ age_2: 2, age_3: 1, age_7: 1, age_15: 2 });
  });
});
