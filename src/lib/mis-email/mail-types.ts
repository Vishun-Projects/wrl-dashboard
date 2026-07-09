/** Client-safe MIS email body metric row (no server/pg imports). */
export type RegionalPerformanceRow = {
  region: string;
  total_calls: number;
  solved_calls: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  active_eng: number;
};
