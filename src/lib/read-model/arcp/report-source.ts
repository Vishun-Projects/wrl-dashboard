import {
  arcpReportUsesLiveCrm,
  readArcpFromPostgres,
} from '@/lib/read-model/flags';

export { arcpReportUsesLiveCrm, readArcpFromPostgres };

/** Parse ?source=crm|postgres on API (overrides env for one request). */
export function arcpForceLiveCrmFromSearchParams(
  searchParams: URLSearchParams
): boolean | undefined {
  const source = searchParams.get('source')?.toLowerCase();
  if (source === 'crm' || source === 'live') return true;
  if (source === 'postgres' || source === 'cache') return false;
  return undefined;
}

export function resolveArcpUsePostgresCache(opts?: {
  forceLiveCrm?: boolean;
  forcePostgresCache?: boolean;
}): boolean {
  if (opts?.forceLiveCrm) return false;
  if (opts?.forcePostgresCache) return true;
  return readArcpFromPostgres();
}
