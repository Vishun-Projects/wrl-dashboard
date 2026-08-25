import { toBigInt } from '@/lib/read-model/transform';
import type { HotRow } from '@/lib/read-model/types';
import type { ColumnMismatch } from '@/lib/read-model/audit/types';

export const HOT_AUDIT_COLUMNS = [
  'ncode',
  'vtrnno',
  'vcclid',
  'nofficeid',
  'nengineer',
  'office_under',
  'franchisee_code',
  'party_name',
  'branch_name',
  'franchisee_name',
  'pincode',
  'city',
  'state',
  'region',
  'account',
  'item_name',
  'serial',
  'wco',
  'engineer_name',
  'call_type',
  'complaint',
  'status_label',
  'status_bucket',
  'solve_remarks',
  'contact_person',
  'phone',
  'address',
  'has_visit',
  'is_major',
  'is_part_pending',
  'branch_headcount',
  'logged_at',
  'solved_at',
  'edited_at',
  'added_at',
  'source_editedon',
  'bsolved',
  'bfastclose',
  'bapproval',
  'bm_approved_at',
  'ncancelreason',
  'lat',
  'lng',
] as const satisfies readonly (keyof HotRow)[];

export type HotAuditColumn = (typeof HOT_AUDIT_COLUMNS)[number];

function normalizeString(value: unknown, uppercase = false): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return uppercase ? text.toUpperCase() : text;
}

function normalizeBigInt(value: unknown): number | null {
  const parsed = toBigInt(value);
  return parsed ?? null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return null;
}

function normalizeDate(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const parsed = new Date(String(value));
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function normalizeCoord(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100000) / 100000;
}

function normalizeInteger(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function compareColumn(column: HotAuditColumn, hot: HotRow, expected: HotRow): ColumnMismatch | null {
  const hotRaw = hot[column];
  const expectedRaw = expected[column];

  switch (column) {
    case 'ncode':
    case 'nofficeid':
    case 'nengineer':
    case 'office_under': {
      const hotVal = normalizeBigInt(hotRaw);
      const expectedVal = normalizeBigInt(expectedRaw);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotVal, expected_value: expectedVal };
      }
      return null;
    }
    case 'region':
    case 'account': {
      const hotVal = normalizeString(hotRaw, true);
      const expectedVal = normalizeString(expectedRaw, true);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotVal, expected_value: expectedVal };
      }
      return null;
    }
    case 'logged_at':
    case 'solved_at':
    case 'edited_at':
    case 'added_at':
    case 'source_editedon':
    case 'bm_approved_at': {
      const hotVal = normalizeDate(hotRaw);
      const expectedVal = normalizeDate(expectedRaw);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotRaw, expected_value: expectedRaw };
      }
      return null;
    }
    case 'bsolved':
    case 'bfastclose':
    case 'bapproval':
    case 'has_visit':
    case 'is_major':
    case 'is_part_pending': {
      const hotVal = normalizeBoolean(hotRaw);
      const expectedVal = normalizeBoolean(expectedRaw);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotVal, expected_value: expectedVal };
      }
      return null;
    }
    case 'lat':
    case 'lng': {
      const hotVal = normalizeCoord(hotRaw);
      const expectedVal = normalizeCoord(expectedRaw);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotVal, expected_value: expectedVal };
      }
      return null;
    }
    case 'branch_headcount':
    case 'ncancelreason': {
      const hotVal = normalizeInteger(hotRaw);
      const expectedVal = normalizeInteger(expectedRaw);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotVal, expected_value: expectedVal };
      }
      return null;
    }
    default: {
      const hotVal = normalizeString(hotRaw);
      const expectedVal = normalizeString(expectedRaw);
      if (hotVal !== expectedVal) {
        return { column, hot_value: hotVal, expected_value: expectedVal };
      }
      return null;
    }
  }
}

/** Compare every HotRow field (excluding synced_at) between hot DB row and CRM-transformed expected row. */
export function diffHotRow(hot: HotRow, expected: HotRow): ColumnMismatch[] {
  const mismatches: ColumnMismatch[] = [];
  for (const column of HOT_AUDIT_COLUMNS) {
    const mismatch = compareColumn(column, hot, expected);
    if (mismatch) mismatches.push(mismatch);
  }
  return mismatches;
}

/** Normalize a Postgres hot row (bigint/date coercion) into HotRow shape for comparison. */
export function normalizeHotRowFromDb(row: Record<string, unknown>): HotRow {
  return {
    ncode: toBigInt(row.ncode) ?? 0,
    vtrnno: String(row.vtrnno ?? '').trim(),
    vcclid: normalizeString(row.vcclid),
    nofficeid: toBigInt(row.nofficeid) ?? 0,
    nengineer: toBigInt(row.nengineer),
    office_under: toBigInt(row.office_under),
    franchisee_code: normalizeString(row.franchisee_code),
    party_name: normalizeString(row.party_name),
    branch_name: normalizeString(row.branch_name),
    franchisee_name: normalizeString(row.franchisee_name),
    pincode: normalizeString(row.pincode),
    city: normalizeString(row.city),
    state: normalizeString(row.state),
    region: normalizeString(row.region, true) ?? 'OTHER',
    account: normalizeString(row.account, true) ?? 'UNCLASSIFIED',
    item_name: normalizeString(row.item_name),
    serial: normalizeString(row.serial),
    wco: (() => {
      const raw = normalizeString(row.wco, true);
      return raw === 'W' || raw === 'C' || raw === 'O' || raw === 'V' ? raw : null;
    })(),
    engineer_name: normalizeString(row.engineer_name),
    call_type: normalizeString(row.call_type),
    complaint: normalizeString(row.complaint),
    status_label: normalizeString(row.status_label),
    status_bucket: row.status_bucket as HotRow['status_bucket'],
    solve_remarks: normalizeString(row.solve_remarks),
    contact_person: normalizeString(row.contact_person),
    phone: normalizeString(row.phone),
    address: normalizeString(row.address),
    has_visit: normalizeBoolean(row.has_visit) ?? false,
    is_major: normalizeBoolean(row.is_major) ?? false,
    is_part_pending: normalizeBoolean(row.is_part_pending) ?? false,
    branch_headcount: normalizeInteger(row.branch_headcount) ?? 0,
    logged_at: row.logged_at instanceof Date ? row.logged_at : new Date(String(row.logged_at)),
    solved_at:
      row.solved_at == null
        ? null
        : row.solved_at instanceof Date
          ? row.solved_at
          : new Date(String(row.solved_at)),
    edited_at:
      row.edited_at == null
        ? null
        : row.edited_at instanceof Date
          ? row.edited_at
          : new Date(String(row.edited_at)),
    added_at:
      row.added_at == null
        ? null
        : row.added_at instanceof Date
          ? row.added_at
          : new Date(String(row.added_at)),
    source_editedon:
      row.source_editedon == null
        ? null
        : row.source_editedon instanceof Date
          ? row.source_editedon
          : new Date(String(row.source_editedon)),
    bsolved: normalizeBoolean(row.bsolved),
    bfastclose: normalizeBoolean(row.bfastclose),
    bapproval: normalizeBoolean(row.bapproval),
    bm_approved_at:
      row.bm_approved_at == null
        ? null
        : row.bm_approved_at instanceof Date
          ? row.bm_approved_at
          : new Date(String(row.bm_approved_at)),
    arcp_bm_approved_at:
      row.arcp_bm_approved_at == null
        ? null
        : row.arcp_bm_approved_at instanceof Date
          ? row.arcp_bm_approved_at
          : new Date(String(row.arcp_bm_approved_at)),
    ncancelreason: normalizeInteger(row.ncancelreason),
    cancel_reason: normalizeString(row.cancel_reason),
    cancelled_at:
      row.cancelled_at == null
        ? null
        : row.cancelled_at instanceof Date
          ? row.cancelled_at
          : new Date(String(row.cancelled_at)),
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
  };
}
