import { describe, expect, it } from 'vitest';
import {
  clubTrendDays,
  monthBucketStart,
  weekBucketStart,
  type TrendDay,
} from '@/app/dashboard/OpsStatusTrendChart';

function day(date: string, solved: number, unallocated = 0): TrendDay {
  return {
    date,
    open: unallocated,
    unallocated,
    assigned: 0,
    solved,
    cancelled: 0,
    tech_solved: 0,
    total: solved + unallocated,
  };
}

describe('clubTrendDays', () => {
  it('keeps daily unchanged', () => {
    const rows = [day('2026-04-28', 10), day('2026-04-29', 5)];
    expect(clubTrendDays(rows, 'day')).toEqual(rows);
  });

  it('sums into week buckets (Mon start)', () => {
    expect(weekBucketStart('2026-04-29')).toBe('2026-04-27'); // Wed → Mon
    const rows = [
      day('2026-04-27', 1, 2),
      day('2026-04-28', 3, 0),
      day('2026-04-29', 4, 1),
      day('2026-05-04', 9, 0), // next Mon
    ];
    expect(clubTrendDays(rows, 'week')).toEqual([
      {
        date: '2026-04-27',
        open: 3,
        unallocated: 3,
        assigned: 0,
        solved: 8,
        cancelled: 0,
        tech_solved: 0,
        total: 11,
      },
      {
        date: '2026-05-04',
        open: 0,
        unallocated: 0,
        assigned: 0,
        solved: 9,
        cancelled: 0,
        tech_solved: 0,
        total: 9,
      },
    ]);
  });

  it('sums into month buckets', () => {
    expect(monthBucketStart('2026-04-30')).toBe('2026-04-01');
    const rows = [day('2026-04-01', 10), day('2026-04-30', 5), day('2026-05-02', 2)];
    const clubbed = clubTrendDays(rows, 'month');
    expect(clubbed).toHaveLength(2);
    expect(clubbed[0]).toMatchObject({ date: '2026-04-01', solved: 15 });
    expect(clubbed[1]).toMatchObject({ date: '2026-05-01', solved: 2 });
  });
});
