/** Shared call sync helpers for Reports + Call Distribution. */

export const REPORT_SYNC_INTERVAL_MS = 60_000;
export const REPORT_SYNC_BUFFER_MS = 30_000;

export function formatSyncTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getCallIdentityKey(rec: Record<string, unknown>): string {
  const unique = rec.UniqueCallNo ?? rec.uniqueCallNo;
  if (unique != null && String(unique) !== '') return String(unique);
  const vtrnno = rec.vtrnno ?? rec.VTRNNO;
  if (vtrnno != null && String(vtrnno) !== '') return String(vtrnno);
  const ncode = rec.ncode ?? rec.id;
  if (ncode != null) return String(ncode);
  return '';
}

export function mergeCallsDelta<T extends Record<string, unknown>>(
  existing: T[],
  deltas: T[],
  keyFn: (rec: T) => string = getCallIdentityKey as (rec: T) => string
): { merged: T[]; addedCount: number; updatedCount: number } {
  const map = new Map<string, T>();
  existing.forEach((row) => {
    const key = keyFn(row);
    if (key) map.set(key, row);
  });

  let addedCount = 0;
  let updatedCount = 0;
  deltas.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    if (map.has(key)) updatedCount++;
    else addedCount++;
    map.set(key, row);
  });

  return { merged: Array.from(map.values()), addedCount, updatedCount };
}

/** Merge partial patches into existing rows (keeps fields not present in the patch). */
export function patchCallsDelta<T extends Record<string, unknown>>(
  existing: T[],
  patches: T[],
  keyFn: (rec: T) => string = getCallIdentityKey as (rec: T) => string
): { merged: T[]; addedCount: number; updatedCount: number } {
  const map = new Map<string, T>();
  existing.forEach((row) => {
    const key = keyFn(row);
    if (key) map.set(key, row);
  });

  let addedCount = 0;
  let updatedCount = 0;
  patches.forEach((patch) => {
    const key = keyFn(patch);
    if (!key) return;
    if (map.has(key)) {
      map.set(key, { ...map.get(key)!, ...patch });
      updatedCount++;
    } else {
      map.set(key, patch);
      addedCount++;
    }
  });

  return { merged: Array.from(map.values()), addedCount, updatedCount };
}

export function mapRegisterRowToDistributionPatch(row: Record<string, unknown>): Record<string, unknown> {
  const bsolved = row.callsolved ?? row.bsolved;
  return {
    vtrnno: row.UniqueCallNo ?? row.vtrnno,
    vcclid: row.vcclid,
    ncode: row.id ?? row.ncode,
    bsolved,
    bfastclose: row.bfastclose,
    ncancelreason: row.ncancelreason,
    nengineer: row.nengineer,
    nofficeid: row.nofficeid,
    state: row.state,
    city: row.city,
    pincode: row.Pincode ?? row.pincode,
    technician_name: row.serviceman ?? row.technician_name,
    franchisee_code: row.franchisee_code,
    franchisee_name: row.franchisee_name,
    vtransfercallno: row.vtransfercallno,
    callsvserialno: row.callsvserialno ?? row.vserialno,
    PartyName: row.PartyName ?? row.party_name,
    itemname: row.itemname,
    vcomplaint: row.vcomplaint,
    office_name: row.office_name ?? row.officename,
    branch_office_name: row.branch_office_name,
    callsdtrndate: row.callsdtrndate,
    calltype: row.calltype,
  };
}

/** Rows loaded via register fetch/sync that include serial — used by Serial Audit without extra API calls. */
const registerRowsWithSerialIndex = new Map<string, Record<string, unknown>>();

export function indexRegisterRowsWithSerial(rows: Record<string, unknown>[]) {
  rows.forEach((row) => {
    const key = getCallIdentityKey(row);
    if (key) registerRowsWithSerialIndex.set(key, row);
  });
}

export function getIndexedRegisterRowsWithSerial(): Record<string, unknown>[] {
  return Array.from(registerRowsWithSerialIndex.values());
}

export function clearRegisterRowsWithSerialIndex() {
  registerRowsWithSerialIndex.clear();
}

export type RegisterDeltaListener = (records: unknown[], syncTime: Date) => void;

const registerDeltaListeners = new Set<RegisterDeltaListener>();

export function subscribeRegisterDelta(listener: RegisterDeltaListener): () => void {
  registerDeltaListeners.add(listener);
  return () => registerDeltaListeners.delete(listener);
}

export function notifyRegisterDelta(records: unknown[], syncTime: Date): void {
  if (records.length > 0) {
    indexRegisterRowsWithSerial(records as Record<string, unknown>[]);
  }
  registerDeltaListeners.forEach((listener) => listener(records, syncTime));
}
