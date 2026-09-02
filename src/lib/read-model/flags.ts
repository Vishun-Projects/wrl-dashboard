import {
  readSourceFromEnv,
  type ReadSource,
} from '@/lib/read-model/read-source-core';

function readSource(envKey: string, fallbackKey = 'READ_CALLS_FROM'): ReadSource {
  return readSourceFromEnv(process.env[envKey], process.env[fallbackKey]);
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

/** Override live CRM: ARCP_USE_LIVE_CRM=true forces CRM; false forces arcp_lines_hot. */
export function arcpReportUsesLiveCrm(): boolean {
  const explicit = process.env.ARCP_USE_LIVE_CRM?.toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return readSource('READ_ARCP_FROM') !== 'postgres';
}

/** ARCP Claims tally/detail from arcp_lines_hot when READ_ARCP_FROM=postgres (VPS). */
export function readArcpFromPostgres(): boolean {
  return !arcpReportUsesLiveCrm() && readSource('READ_ARCP_FROM') === 'postgres';
}

export function readCallsFromPostgres(): boolean {
  return (
    readSummaryFromPostgres() ||
    readRegisterFromPostgres() ||
    readDistributionFromPostgres() ||
    readArcpFromPostgres()
  );
}
