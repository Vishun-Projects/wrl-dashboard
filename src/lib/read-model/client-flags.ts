type ReadSource = 'crm' | 'postgres';

/** Next.js only inlines NEXT_PUBLIC_* when accessed with literal keys — not process.env[variable]. */
function readClientSource(
  specific: string | undefined,
  global: string | undefined = process.env.NEXT_PUBLIC_READ_CALLS_FROM
): ReadSource {
  const specificNorm = specific?.toLowerCase();
  if (specificNorm === 'postgres' || specificNorm === 'crm') return specificNorm;
  const globalNorm = global?.toLowerCase();
  if (globalNorm === 'postgres' || globalNorm === 'crm') return globalNorm;
  return 'crm';
}

export function readSummaryFromPostgresClient(): boolean {
  return (
    readClientSource(process.env.NEXT_PUBLIC_READ_SUMMARY_FROM) === 'postgres'
  );
}

export function readRegisterFromPostgresClient(): boolean {
  return (
    readClientSource(process.env.NEXT_PUBLIC_READ_REGISTER_FROM) === 'postgres'
  );
}

export function readDistributionFromPostgresClient(): boolean {
  return (
    readClientSource(process.env.NEXT_PUBLIC_READ_DISTRIBUTION_FROM) === 'postgres'
  );
}

export function readDimsFromPostgresClient(): boolean {
  return readClientSource(process.env.NEXT_PUBLIC_READ_DIMS_FROM) === 'postgres';
}

export function readArcpFromPostgresClient(): boolean {
  return readClientSource(process.env.NEXT_PUBLIC_READ_ARCP_FROM) === 'postgres';
}

export function readCallsFromPostgresClient(): boolean {
  return (
    readSummaryFromPostgresClient() ||
    readRegisterFromPostgresClient() ||
    readDistributionFromPostgresClient() ||
    readArcpFromPostgresClient()
  );
}

/**
 * Browser must not run CRM ingest when the UI reads from Postgres — that runs on the sync worker.
 * (Calling CRM from Vercel can hit viewstate OOM; the refresh button reloads from Supabase only.)
 */
export function postgresAutoSyncEnabled(): boolean {
  if (readCallsFromPostgresClient()) return false;
  return process.env.NEXT_PUBLIC_AUTO_SYNC_ENABLED !== 'false';
}

export function postgresAutoSyncIntervalMs(): number {
  const configured = Number(process.env.NEXT_PUBLIC_AUTO_SYNC_INTERVAL_MS);
  if (Number.isFinite(configured) && configured >= 60_000) return configured;
  return 3 * 60 * 1000;
}
