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

/** Postgres register APIs (/totals, /filter-options) when READ_REGISTER_FROM=postgres. */
export function registerPostgresHotPathAvailable(
  _startDate?: string,
  _endDate?: string
): boolean {
  return readRegisterFromPostgresClient();
}

function readDistributionFromPostgresClient(): boolean {
  return (
    readClientSource(process.env.NEXT_PUBLIC_READ_DISTRIBUTION_FROM) === 'postgres'
  );
}

function arcpReportUsesLiveCrmClient(): boolean {
  const explicit = process.env.NEXT_PUBLIC_ARCP_USE_LIVE_CRM?.toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return readClientSource(process.env.NEXT_PUBLIC_READ_ARCP_FROM) !== 'postgres';
}

/** Matches server READ_ARCP_FROM — plans loads against arcp_lines_hot on VPS. */
export function readArcpFromPostgresClient(): boolean {
  return (
    !arcpReportUsesLiveCrmClient() &&
    readClientSource(process.env.NEXT_PUBLIC_READ_ARCP_FROM) === 'postgres'
  );
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
