type ReadSource = 'crm' | 'postgres';

function readSource(envKey: string, fallbackKey = 'READ_CALLS_FROM'): ReadSource {
  const specific = process.env[envKey]?.toLowerCase();
  if (specific === 'postgres' || specific === 'crm') return specific;
  const global = process.env[fallbackKey]?.toLowerCase();
  if (global === 'postgres' || global === 'crm') return global;
  return 'crm';
}

export function readSummaryFromPostgres(): boolean {
  return readSource('READ_SUMMARY_FROM') === 'postgres';
}

export function readRegisterFromPostgres(): boolean {
  return readSource('READ_REGISTER_FROM') === 'postgres';
}

export function readDistributionFromPostgres(): boolean {
  return readSource('READ_DISTRIBUTION_FROM') === 'postgres';
}

export function readDimsFromPostgres(): boolean {
  return readSource('READ_DIMS_FROM') === 'postgres';
}

/** ARCP Claims: live Western CRM by default; set ARCP_USE_LIVE_CRM=false for arcp_lines_hot. */
export function arcpReportUsesLiveCrm(): boolean {
  const explicit = process.env.ARCP_USE_LIVE_CRM?.toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return true;
}

/** ARCP Claims always reads live Western CRM (trhcalls date basis); Postgres hot table is not used. */
export function readArcpFromPostgres(): boolean {
  return false;
}

export function readCallsFromPostgres(): boolean {
  return (
    readSummaryFromPostgres() ||
    readRegisterFromPostgres() ||
    readDistributionFromPostgres() ||
    readArcpFromPostgres()
  );
}
