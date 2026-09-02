/**
 * Diff legacy BD MIS open rows (3702) vs unified open rows (3690).
 * Usage: npx tsx scripts/ops/diff-unified-vs-legacy-open.ts
 */
import '@/modules/mis-email/services/bootstrap-env';
import { buildDigestTraceableExportPayload } from '@/modules/mis-email/services/fetch-digest-trace';
import { fetchDigestSummaryDataCached, fetchDigestClientAccountSummaryCached } from '@/modules/mis-email/services/digest-cache';
import { resolveDigestDateRangeForPreferences } from '@/modules/mis-email/services/preferences';
import { resolveUserDigestScopeWithLabel } from '@/modules/mis-email/services/user-scope';
import { loadDigestRecipients } from '@/modules/mis-email/services/recipients';
import {
  filterTraceRowsForSummaryExport,
  countTraceOpenCalls,
  type BdMisTraceRow,
} from '@/modules/mis/services/bd-mis-trace';
import {
  filterTraceRowsForUnifiedOpenExport,
  countUnifiedTraceOpenCalls,
} from '@/modules/mis/services/mis-unified-metrics';
import { closePool } from '@/lib/read-model/db';

function openKey(row: BdMisTraceRow): string {
  return String(row.service_order ?? '').trim() || `${row.client}::${row.call_date_time}::${row.plant}`;
}

function summarize(rows: BdMisTraceRow[]) {
  const byAccount = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const row of rows) {
    const acct = String(row.client ?? '—');
    byAccount.set(acct, (byAccount.get(acct) ?? 0) + 1);
    byRegion.set(row.region, (byRegion.get(row.region) ?? 0) + 1);
    bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
  }
  return {
    byAccount: [...byAccount.entries()].sort((a, b) => b[1] - a[1]),
    byRegion: [...byRegion.entries()].sort((a, b) => b[1] - a[1]),
    bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]),
  };
}

async function main(): Promise<void> {
  const recipients = await loadDigestRecipients();
  const r = recipients[0];
  if (!r) throw new Error('No recipient');
  const dateRange = resolveDigestDateRangeForPreferences(r.mis_email_preferences);
  const scope = await resolveUserDigestScopeWithLabel(r);
  const summary = await fetchDigestSummaryDataCached(scope, dateRange);
  const clientAccounts = await fetchDigestClientAccountSummaryCached(dateRange);

  const payload = await buildDigestTraceableExportPayload(
    scope,
    dateRange,
    summary,
    clientAccounts,
    { includeOpenCallsExport: true, includeTraceableExport: false }
  );

  const legacyOpenRows = filterTraceRowsForSummaryExport(payload.traceRows).filter(
    (row) => row.included_in_final_count && row.counts_toward === 'open'
  );
  const unifiedOpenRows = filterTraceRowsForUnifiedOpenExport(payload.traceRows).filter(
    (row) => row.counts_toward === 'open'
  );

  const legacyKeys = new Set(legacyOpenRows.map(openKey));
  const unifiedKeys = new Set(unifiedOpenRows.map(openKey));

  const onlyLegacy = legacyOpenRows.filter((row) => !unifiedKeys.has(openKey(row)));
  const onlyUnified = unifiedOpenRows.filter((row) => !legacyKeys.has(openKey(row)));

  console.log('\n=== OPEN COUNT DIFF ===');
  console.log('Legacy BD MIS open:', countTraceOpenCalls(filterTraceRowsForSummaryExport(payload.traceRows)));
  console.log('Unified open:', countUnifiedTraceOpenCalls(payload.traceRows));
  console.log('Only in legacy (ignored by unified):', onlyLegacy.length);
  console.log('Only in unified (not in legacy):', onlyUnified.length);

  console.log('\n--- 12 calls ONLY in legacy (3702 side, dropped in 3690) ---');
  console.log('By account:', summarize(onlyLegacy).byAccount);
  console.log('By region:', summarize(onlyLegacy).byRegion);
  console.log('By source:', summarize(onlyLegacy).bySource);
  console.log('\nSample rows (up to 15):');
  for (const row of onlyLegacy.slice(0, 15)) {
    console.log({
      service_order: row.service_order,
      client: row.client,
      source: row.source,
      region: row.region,
      plant: row.plant,
      file_name: row.file_name,
      contribution_step: row.contribution_step,
      included_in_final_count: row.included_in_final_count,
    });
  }

  if (onlyUnified.length) {
    console.log('\n--- Only in unified (not in legacy) ---');
    console.log('By account:', summarize(onlyUnified).byAccount);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
