/** Shared call sync helpers for Reports + Call Distribution. */

export const REPORT_SYNC_INTERVAL_MS = 60_000;
export const REPORT_SYNC_BUFFER_MS = 30_000;
/** After hydrate from cache, skip automatic delta sync so reload/tab focus stays instant. */
export const REPORT_AUTO_SYNC_GRACE_MS = 5 * 60 * 1000;

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
