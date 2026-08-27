import { parseCrmDate } from '@/lib/read-model/dates';

export type UserLocationRow = {
  ncode: number;
  /** CRM nuser — may be fractional (e.g. 590.3). Do not truncate. */
  user_id: number | null;
  office_id: number | null;
  latlong: string | null;
  added_on: Date | null;
  added_on_raw: string | null;
  acode: string | null;
  action_type: string | null;
  distance: number | null;
  trn_ncode: number | null;
  trn_no: string | null;
  customer_name: string | null;
  travel_mode: string | null;
};

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase());
    if (!actual) continue;
    const text = String(row[actual] ?? '').trim();
    if (text) return text;
  }
  return '';
}

function emptyToNull(value: string): string | null {
  return value || null;
}

function parseId(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** CRM nuser can be fractional (590.3). Truncating merges all office techs. */
function parseNuser(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseAmt(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function mapCrmUserLocationRow(raw: Record<string, unknown>): UserLocationRow | null {
  const ncode = parseId(pick(raw, 'ncode'));
  if (ncode == null) return null;
  const addedOnRaw = pick(raw, 'addedon');
  return {
    ncode,
    user_id: parseNuser(pick(raw, 'nuser')),
    office_id: parseId(pick(raw, 'nofficeid')),
    latlong: emptyToNull(pick(raw, 'vlatlong')),
    added_on: parseCrmDate(addedOnRaw),
    added_on_raw: emptyToNull(addedOnRaw),
    acode: emptyToNull(pick(raw, 'acode')),
    action_type: emptyToNull(pick(raw, 'ACTION_TYPE', 'action_type')),
    distance: parseAmt(pick(raw, 'Distance', 'distance')),
    trn_ncode: parseId(pick(raw, 'ncodetrn')),
    trn_no: emptyToNull(pick(raw, 'vtrnno')),
    customer_name: emptyToNull(pick(raw, 'vcustomername')),
    travel_mode: emptyToNull(pick(raw, 'vtravelmode')),
  };
}
