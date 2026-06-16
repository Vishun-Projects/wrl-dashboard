/** Client-safe — no Node pg imports. */

export type ArcpPostgresCoverage = {
  rowCount: number;
  status: string | null;
  backfillStart: string;
  callAt: { min: string | null; max: string | null };
  solveAt: { min: string | null; max: string | null };
  bmApprovedAt: { min: string | null; max: string | null };
  hoApprovedAt: { min: string | null; max: string | null };
};

export type ArcpCoverageDateColumn =
  | 'dcalllogdatetime'
  | 'dsolveddatetime'
  | 'bm_approved_at';

function boundsForColumn(
  coverage: ArcpPostgresCoverage,
  dateColumn: ArcpCoverageDateColumn
): { min: string | null; max: string | null } {
  if (dateColumn === 'dsolveddatetime') return coverage.solveAt;
  if (dateColumn === 'bm_approved_at') return coverage.bmApprovedAt;
  return coverage.callAt;
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export type ArcpCoverageSegment = {
  mode: 'postgres' | 'crm';
  start: string;
  end: string;
};

/**
 * Split a report date range into Postgres vs live CRM windows using loaded
 * min/max for the active date basis (call / solve / BM on trhcalls when using live CRM).
 */
export function planArcpCoverageSegments(
  startDate: string,
  endDate: string,
  coverage: ArcpPostgresCoverage,
  dateColumn: ArcpCoverageDateColumn
): ArcpCoverageSegment[] {
  if (startDate > endDate) return [];
  if (coverage.rowCount === 0) {
    return [{ mode: 'crm', start: startDate, end: endDate }];
  }

  const { min, max } = boundsForColumn(coverage, dateColumn);
  const covMin = min ?? coverage.backfillStart;
  const covMax = max;

  if (!covMax) {
    return [{ mode: 'crm', start: startDate, end: endDate }];
  }

  const segments: ArcpCoverageSegment[] = [];

  if (startDate < covMin) {
    segments.push({
      mode: 'crm',
      start: startDate,
      end: addDaysToYmd(covMin, -1),
    });
  }

  const pgStart = startDate > covMin ? startDate : covMin;
  const pgEnd = endDate < covMax ? endDate : covMax;
  if (pgStart <= pgEnd) {
    segments.push({ mode: 'postgres', start: pgStart, end: pgEnd });
  }

  if (endDate > covMax) {
    segments.push({
      mode: 'crm',
      start: addDaysToYmd(covMax, 1),
      end: endDate,
    });
  }

  return segments.filter((s) => s.start <= s.end);
}

/** True when every day in the report range is inside loaded Postgres min/max for this date basis. */
export function postgresCoversFullRange(
  startDate: string,
  endDate: string,
  coverage: ArcpPostgresCoverage,
  dateColumn: ArcpCoverageDateColumn
): boolean {
  if (coverage.rowCount === 0) return false;
  const { min, max } = boundsForColumn(coverage, dateColumn);
  if (!max) return false;
  const covMin = min ?? coverage.backfillStart;
  return startDate >= covMin && endDate <= max;
}

/** True when this period is entirely outside loaded arcp_lines_hot (skip live CRM). */
export function isArcpChunkOutsidePostgresCoverage(
  chunk: { start: string; end: string },
  coverage: ArcpPostgresCoverage,
  dateColumn: ArcpCoverageDateColumn
): boolean {
  if (coverage.rowCount === 0) return false;
  const { min, max } = boundsForColumn(coverage, dateColumn);
  if (!max && !min) {
    const call = coverage.callAt;
    if (!call.max) return false;
    if (call.min && chunk.end < call.min) return true;
    if (chunk.start > call.max) return true;
    return false;
  }
  if (!max) return false;
  if (min && chunk.end < min) return true;
  if (chunk.start > max) return true;
  return false;
}

const COVERAGE_BASIS_LABEL: Record<ArcpCoverageDateColumn, string> = {
  dcalllogdatetime: 'Call Date',
  dsolveddatetime: 'Solve Date',
  bm_approved_at: 'BM Call Approved',
};

function formatCoverageDateLabel(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd.slice(0, 10);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** User-facing hint when the mirror has not synced through the selected date basis. */
export function describeArcpMirrorCoverageGap(
  startDate: string,
  endDate: string,
  coverage: ArcpPostgresCoverage,
  dateColumn: ArcpCoverageDateColumn
): string | null {
  if (startDate > endDate) return null;
  const basis = COVERAGE_BASIS_LABEL[dateColumn];

  if (coverage.rowCount === 0) {
    return `No ARCP data in the mirror yet. Run the sync worker to load ${basis} claims.`;
  }

  const { max } = boundsForColumn(coverage, dateColumn);
  if (!max) {
    return `No ${basis} dates in the mirror yet. Sync worker must backfill approval dates before this filter can return rows.`;
  }

  const covMax = max.slice(0, 10);
  if (endDate <= covMax) return null;

  const through = formatCoverageDateLabel(covMax);
  if (startDate > covMax) {
    return `No ${basis} rows in the mirror for this range. Mirror is current through ${through} — sync is still catching up.`;
  }

  return `${basis} in the mirror only through ${through}. Later dates in your range are not synced yet.`;
}
