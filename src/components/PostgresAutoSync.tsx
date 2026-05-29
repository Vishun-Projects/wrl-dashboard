'use client';

import { useEffect } from 'react';
import { postgresAutoSyncEnabled } from '@/lib/read-model/client-flags';

/**
 * Reserved hook for future client-side refresh scheduling.
 * CRM→Postgres ingest is handled by the sync worker, not the browser.
 */
export function PostgresAutoSync() {
  useEffect(() => {
    if (!postgresAutoSyncEnabled()) return;
  }, []);

  return null;
}
