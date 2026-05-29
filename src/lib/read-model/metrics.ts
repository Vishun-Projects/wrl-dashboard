import { normalizeCallTypeDisplay } from '@/lib/report-filters';
import type { FactCounts, FactKey, HotRow } from '@/lib/read-model/types';
import { currentYearStart, factDateFromLoggedAt } from '@/lib/read-model/dates';

const DEPLOYMENT = 'DEPLOYMENT';
const INSTALLATION = 'INSTALLATION CALL';

export function emptyFactCounts(): FactCounts {
  return {
    total: 0,
    solved: 0,
    cancelled: 0,
    open_count: 0,
    tech_solved: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
  };
}

export function factKeyFromHotRow(row: HotRow): FactKey {
  return {
    fact_date: factDateFromLoggedAt(row.logged_at),
    office_id: row.nofficeid,
    call_type: row.call_type ?? 'UNKNOWN',
    account: row.account,
    region: row.region,
  };
}

export function serializeFactKey(key: FactKey): string {
  return `${key.fact_date}|${key.office_id}|${key.call_type}|${key.account}|${key.region}`;
}

function callTypeIs(callType: string | null, expected: string): boolean {
  return normalizeCallTypeDisplay(callType) === normalizeCallTypeDisplay(expected);
}

export function factCountsFromHotRow(row: HotRow): FactCounts {
  const counts = emptyFactCounts();
  counts.total = 1;

  switch (row.status_bucket) {
    case 'solved':
      counts.solved = 1;
      break;
    case 'cancelled':
      counts.cancelled = 1;
      break;
    case 'tech_solved':
      counts.tech_solved = 1;
      break;
    case 'open_unallocated':
    case 'assigned':
      counts.open_count = 1;
      break;
  }

  if (callTypeIs(row.call_type, DEPLOYMENT)) {
    counts.deployment_total = 1;
    if (row.status_bucket === 'solved' || row.status_bucket === 'tech_solved') {
      counts.deployment_done = 1;
    }
  }
  if (callTypeIs(row.call_type, INSTALLATION)) {
    counts.installation_total = 1;
    if (row.status_bucket === 'solved' || row.status_bucket === 'tech_solved') {
      counts.installation_done = 1;
    }
  }

  return counts;
}

export function addFactCounts(target: FactCounts, delta: FactCounts): void {
  target.total += delta.total;
  target.solved += delta.solved;
  target.cancelled += delta.cancelled;
  target.open_count += delta.open_count;
  target.tech_solved += delta.tech_solved;
  target.deployment_total += delta.deployment_total;
  target.deployment_done += delta.deployment_done;
  target.installation_total += delta.installation_total;
  target.installation_done += delta.installation_done;
}

export function subtractFactCounts(target: FactCounts, delta: FactCounts): void {
  target.total -= delta.total;
  target.solved -= delta.solved;
  target.cancelled -= delta.cancelled;
  target.open_count -= delta.open_count;
  target.tech_solved -= delta.tech_solved;
  target.deployment_total -= delta.deployment_total;
  target.deployment_done -= delta.deployment_done;
  target.installation_total -= delta.installation_total;
  target.installation_done -= delta.installation_done;
}

function factCountsHasDelta(counts: FactCounts): boolean {
  return (
    counts.total !== 0 ||
    counts.solved !== 0 ||
    counts.cancelled !== 0 ||
    counts.open_count !== 0 ||
    counts.tech_solved !== 0 ||
    counts.deployment_total !== 0 ||
    counts.deployment_done !== 0 ||
    counts.installation_total !== 0 ||
    counts.installation_done !== 0
  );
}

/** Net metric deltas after subtracting old hot rows and adding new (incremental sync). */
export function buildNetFactDeltas(
  oldRows: HotRow[],
  newRows: HotRow[]
): Array<{ key: FactKey; delta: FactCounts }> {
  const yearStart = currentYearStart();
  const map = new Map<string, FactKey & FactCounts>();

  for (const row of oldRows) {
    const key = factKeyFromHotRow(row);
    if (key.fact_date < yearStart) continue;
    const serialized = serializeFactKey(key);
    const entry = map.get(serialized) ?? { ...key, ...emptyFactCounts() };
    subtractFactCounts(entry, factCountsFromHotRow(row));
    map.set(serialized, entry);
  }

  for (const row of newRows) {
    const key = factKeyFromHotRow(row);
    if (key.fact_date < yearStart) continue;
    const serialized = serializeFactKey(key);
    const entry = map.get(serialized) ?? { ...key, ...emptyFactCounts() };
    addFactCounts(entry, factCountsFromHotRow(row));
    map.set(serialized, entry);
  }

  const out: Array<{ key: FactKey; delta: FactCounts }> = [];
  for (const entry of map.values()) {
    const { fact_date, office_id, call_type, account, region, ...counts } = entry;
    if (!factCountsHasDelta(counts)) continue;
    out.push({
      key: { fact_date, office_id, call_type, account, region },
      delta: counts,
    });
  }
  return out;
}

export function aggregateFactCounts(rows: HotRow[]): Map<string, FactKey & FactCounts> {
  const yearStart = currentYearStart();
  const map = new Map<string, FactKey & FactCounts>();

  for (const row of rows) {
    const key = factKeyFromHotRow(row);
    if (key.fact_date < yearStart) continue;
    const serialized = serializeFactKey(key);
    const existing = map.get(serialized) ?? { ...key, ...emptyFactCounts() };
    addFactCounts(existing, factCountsFromHotRow(row));
    map.set(serialized, existing);
  }

  return map;
}

export function aggregateFactCountsFromEligibleRows(
  rows: Record<string, unknown>[],
  transform: (row: Record<string, unknown>) => HotRow | null
): Map<string, FactKey & FactCounts> {
  const hotRows: HotRow[] = [];
  for (const row of rows) {
    const hot = transform(row);
    if (hot) hotRows.push(hot);
  }
  return aggregateFactCounts(hotRows);
}
