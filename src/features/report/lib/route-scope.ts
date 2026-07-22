import {
  readCallsFromPostgresClient,
  readRegisterFromPostgresClient,
} from '@/lib/read-model/client-flags';

export function routeNeedsCorpusPreload(pathname: string | null): boolean {
  if (!pathname) return false;
  if (readCallsFromPostgresClient()) return false;
  return (
    pathname === '/report' ||
    pathname === '/report/' ||
    pathname.startsWith('/report/distribution')
  );
}

export function routeNeedsSharedResources(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === '/report' ||
    pathname === '/report/' ||
    pathname.startsWith('/report/distribution') ||
    pathname.startsWith('/report/arcp-claims') ||
    pathname.startsWith('/report/location-audit') ||
    pathname.startsWith('/report/serial-audit')
  );
}

export function routeNeedsDistributionPreload(pathname: string | null): boolean {
  if (readRegisterFromPostgresClient()) return false;
  return routeNeedsCorpusPreload(pathname);
}
