/** Period visit date stats — independent max/min, not both from one visit. */
export function latestDatesFromCalls(
  calls: Array<{ call_date?: string | null; solve_date?: string | null }>
): {
  latest_call_date: string;
  earliest_call_date: string;
  latest_solve_date: string | null;
} {
  let latestCall: string | null = null;
  let latestCallMs = -Infinity;
  let earliestCall: string | null = null;
  let earliestCallMs = Infinity;
  let latestSolve: string | null = null;
  let latestSolveMs = -Infinity;

  for (const c of calls) {
    if (c.call_date) {
      const ms = new Date(c.call_date).getTime();
      if (!Number.isNaN(ms)) {
        if (ms >= latestCallMs) {
          latestCallMs = ms;
          latestCall = c.call_date;
        }
        if (ms <= earliestCallMs) {
          earliestCallMs = ms;
          earliestCall = c.call_date;
        }
      }
    }
    if (c.solve_date) {
      const ms = new Date(c.solve_date).getTime();
      if (!Number.isNaN(ms) && ms >= latestSolveMs) {
        latestSolveMs = ms;
        latestSolve = c.solve_date;
      }
    }
  }

  return {
    latest_call_date: latestCall || '',
    earliest_call_date: earliestCall || latestCall || '',
    latest_solve_date: latestSolve,
  };
}

/** True when earliest/latest call dates fall on different calendar days. */
export function callDatesSpanDays(earliest: string, latest: string): boolean {
  if (!earliest || !latest || earliest === latest) return false;
  const a = new Date(earliest);
  const b = new Date(latest);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}
