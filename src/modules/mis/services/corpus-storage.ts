/** IndexedDB persistence for the unified call corpus (meta-first restore). */

export const REPORTS_DB_NAME = 'wrl_reports_db';
/** Keep in sync everywhere this database is opened (report page + corpus cache). */
export const REPORTS_DB_VERSION = 2;
const CORPUS_META_KEY = 'corpus_meta';
const SHARED_REGISTER_STORE = 'shared_register';

/** Bump when bulk preload shape/strategy changes — stale IndexedDB entries are ignored. */
export const SHARED_REGISTER_CACHE_VERSION = 2;

export type CorpusMeta = {
  cacheKey: string;
  fetchedAt: number;
  lastSyncedAt: number;
  callCount: number;
  truncated?: boolean;
};

type SharedRegisterCache = {
  cacheKey: string;
  calls: Record<string, unknown>[];
  fetchedAt: number;
  lastSyncedAt: number;
  callCount: number;
  schemaVersion: number;
};

export function openReportsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Not in browser'));
      return;
    }
    const request = indexedDB.open(REPORTS_DB_NAME, REPORTS_DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('calls')) {
        db.createObjectStore('calls', { keyPath: 'UniqueCallNo' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
      if (!db.objectStoreNames.contains(SHARED_REGISTER_STORE)) {
        db.createObjectStore(SHARED_REGISTER_STORE, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    request.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export async function readCorpusMeta(): Promise<CorpusMeta | null> {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(CORPUS_META_KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as CorpusMeta) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/** Lazy full read — only after meta matches; avoids getAll on cold boot when meta mismatches. */
export async function readCorpusCallsLazy(): Promise<Record<string, unknown>[]> {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('calls', 'readonly');
    const store = tx.objectStore('calls');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as Record<string, unknown>[]) || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function persistCorpusCalls(
  calls: Record<string, unknown>[],
  meta: CorpusMeta
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openReportsDb();
    const tx = db.transaction(['calls', 'meta'], 'readwrite');
    const callStore = tx.objectStore('calls');
    callStore.clear();
    for (const row of calls) {
      const key = row.UniqueCallNo ?? row.vtrnno;
      if (key) callStore.put({ ...row, UniqueCallNo: key });
    }
    tx.objectStore('meta').put(meta, CORPUS_META_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Corpus IndexedDB persist error:', err);
  }
}

export async function patchCorpusCallsInDB(
  patches: Record<string, unknown>[],
  meta: Partial<CorpusMeta>
): Promise<void> {
  if (typeof window === 'undefined' || patches.length === 0) return;
  try {
    const existing = await readCorpusMeta();
    const db = await openReportsDb();
    const tx = db.transaction(['calls', 'meta'], 'readwrite');
    const callStore = tx.objectStore('calls');
    for (const patch of patches) {
      const key = patch.UniqueCallNo ?? patch.vtrnno;
      if (!key) continue;
      callStore.put({ ...patch, UniqueCallNo: key });
    }
    if (meta.cacheKey) {
      tx.objectStore('meta').put(
        {
          cacheKey: meta.cacheKey ?? existing?.cacheKey ?? '',
          fetchedAt: meta.fetchedAt ?? existing?.fetchedAt ?? Date.now(),
          lastSyncedAt: meta.lastSyncedAt ?? Date.now(),
          callCount: meta.callCount ?? existing?.callCount ?? patches.length,
          truncated: meta.truncated ?? existing?.truncated,
        },
        CORPUS_META_KEY
      );
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Corpus IndexedDB patch error:', err);
  }
}

export async function readSharedRegisterCache(
  cacheKey: string
): Promise<SharedRegisterCache | null> {
  try {
    const db = await openReportsDb();
    const tx = db.transaction(SHARED_REGISTER_STORE, 'readonly');
    const request = tx.objectStore(SHARED_REGISTER_STORE).get(cacheKey);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as SharedRegisterCache) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function persistSharedRegisterCache(cache: SharedRegisterCache): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openReportsDb();
    const tx = db.transaction(SHARED_REGISTER_STORE, 'readwrite');
    tx.objectStore(SHARED_REGISTER_STORE).put(cache);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Shared register IndexedDB persist error:', err);
  }
}
