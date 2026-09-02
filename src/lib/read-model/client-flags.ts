import { readSourceFromEnv } from '@/lib/read-model/read-source-core';

/** Next.js only inlines NEXT_PUBLIC_* when accessed with literal keys — not process.env[variable]. */
export function readSummaryFromPostgresClient(): boolean {
  return (
    readSourceFromEnv(
      process.env.NEXT_PUBLIC_READ_SUMMARY_FROM,
      process.env.NEXT_PUBLIC_READ_CALLS_FROM
    ) === 'postgres'
  );
}

export function readRegisterFromPostgresClient(): boolean {
  return (
    readSourceFromEnv(
      process.env.NEXT_PUBLIC_READ_REGISTER_FROM,
      process.env.NEXT_PUBLIC_READ_CALLS_FROM
    ) === 'postgres'
  );
}

function readDistributionFromPostgresClient(): boolean {
  return (
    readSourceFromEnv(
      process.env.NEXT_PUBLIC_READ_DISTRIBUTION_FROM,
      process.env.NEXT_PUBLIC_READ_CALLS_FROM
    ) === 'postgres'
  );
}

function arcpReportUsesLiveCrmClient(): boolean {
  const explicit = process.env.NEXT_PUBLIC_ARCP_USE_LIVE_CRM?.toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return (
    readSourceFromEnv(
      process.env.NEXT_PUBLIC_READ_ARCP_FROM,
      process.env.NEXT_PUBLIC_READ_CALLS_FROM
    ) !== 'postgres'
  );
}

/** Matches server READ_ARCP_FROM — plans loads against arcp_lines_hot on VPS. */
export function readArcpFromPostgresClient(): boolean {
  return (
    !arcpReportUsesLiveCrmClient() &&
    readSourceFromEnv(
      process.env.NEXT_PUBLIC_READ_ARCP_FROM,
      process.env.NEXT_PUBLIC_READ_CALLS_FROM
    ) === 'postgres'
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
