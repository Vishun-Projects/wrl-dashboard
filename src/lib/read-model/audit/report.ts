import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { AuditMismatch, AuditSummary } from '@/lib/read-model/audit/types';

export type AuditReportWriter = {
  writeMismatch: (mismatch: AuditMismatch) => void;
  writeSummary: (summary: AuditSummary) => string;
  summaryPath: string;
  jsonlPath: string;
};

export function createAuditReportWriter(timestamp?: string): AuditReportWriter {
  const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'logs', 'audit');
  mkdirSync(dir, { recursive: true });
  const summaryPath = join(dir, `read-model-${ts}.json`);
  const jsonlPath = join(dir, `read-model-${ts}.jsonl`);
  writeFileSync(jsonlPath, '');
  const pendingLines: string[] = [];
  const flushThreshold = 500;

  function flushPending(): void {
    if (!pendingLines.length) return;
    appendFileSync(jsonlPath, `${pendingLines.join('\n')}\n`, 'utf8');
    pendingLines.length = 0;
  }

  return {
    summaryPath,
    jsonlPath,
    writeMismatch(mismatch: AuditMismatch) {
      pendingLines.push(JSON.stringify(mismatch));
      if (pendingLines.length >= flushThreshold) flushPending();
    },
    writeSummary(summary: AuditSummary) {
      flushPending();
      writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      return summaryPath;
    },
  };
}

export function countTotalMismatches(summary: AuditSummary): number {
  let total = 0;
  if (summary.hot) {
    total +=
      summary.hot.column_mismatch_rows +
      summary.hot.missing_in_crm +
      summary.hot.should_not_exist;
  }
  if (summary.dims.offices) {
    total +=
      summary.dims.offices.missing_in_postgres +
      summary.dims.offices.extra_in_postgres +
      summary.dims.offices.column_mismatch_rows;
  }
  if (summary.dims.engineers) {
    total +=
      summary.dims.engineers.missing_in_postgres +
      summary.dims.engineers.extra_in_postgres +
      summary.dims.engineers.column_mismatch_rows;
  }
  if (summary.dims.call_types) {
    total +=
      summary.dims.call_types.missing_in_postgres +
      summary.dims.call_types.extra_in_postgres +
      summary.dims.call_types.column_mismatch_rows;
  }
  if (summary.facts) {
    total +=
      summary.facts.missing_in_postgres +
      summary.facts.extra_in_postgres +
      summary.facts.column_mismatch_keys;
  }
  if (summary.plant) {
    total += summary.plant.orphan_office_ids + summary.plant.invalid_zones;
  }
  if (summary.reverse) {
    total += summary.reverse.in_crm_not_in_hot + summary.reverse.in_hot_not_eligible;
  }
  return total;
}

export function printAuditSummary(summary: AuditSummary): void {
  console.log('\n=== Read-model audit summary ===');
  console.log(`Started:  ${summary.started_at}`);
  console.log(`Finished: ${summary.finished_at ?? '(in progress)'}`);
  console.log(`Phases:   ${summary.phases_run.join(', ')}`);
  console.log(`Apply:    ${summary.apply_mode}`);
  console.log(`Total mismatches: ${summary.total_mismatches}`);

  if (summary.hot) {
    console.log('\nHot (calls_latest_hot):');
    console.log(`  rows checked:          ${summary.hot.rows_checked}`);
    console.log(`  column mismatch rows:  ${summary.hot.column_mismatch_rows}`);
    console.log(`  column mismatches:     ${summary.hot.column_mismatches}`);
    console.log(`  missing in CRM:        ${summary.hot.missing_in_crm}`);
    console.log(`  should not exist:      ${summary.hot.should_not_exist}`);
    const topCols = Object.entries(summary.hot.by_column)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (topCols.length) {
      console.log(`  top columns:           ${topCols.map(([c, n]) => `${c}=${n}`).join(', ')}`);
    }
  }

  if (summary.dims.offices || summary.dims.engineers || summary.dims.call_types) {
    console.log('\nDimensions:');
    for (const [name, dim] of Object.entries(summary.dims)) {
      if (!dim) continue;
      console.log(
        `  ${name}: pg=${dim.postgres_count} crm=${dim.crm_count} missing=${dim.missing_in_postgres} extra=${dim.extra_in_postgres} col_mismatch_rows=${dim.column_mismatch_rows}`
      );
    }
  }

  if (summary.facts) {
    console.log('\nFacts (call_metrics_daily):');
    console.log(`  keys checked:       ${summary.facts.keys_checked}`);
    console.log(`  mismatch keys:      ${summary.facts.column_mismatch_keys}`);
    console.log(`  missing in PG:      ${summary.facts.missing_in_postgres}`);
    console.log(`  extra in PG:        ${summary.facts.extra_in_postgres}`);
  }

  if (summary.plant) {
    console.log('\nPlant mappings:');
    console.log(`  rows:          ${summary.plant.rows_checked}`);
    console.log(`  orphan FKs:    ${summary.plant.orphan_office_ids}`);
    console.log(`  invalid zones: ${summary.plant.invalid_zones}`);
  }

  if (summary.reverse) {
    console.log('\nReverse TRN set:');
    console.log(`  CRM eligible:      ${summary.reverse.crm_eligible_count}`);
    console.log(`  hot count:         ${summary.reverse.hot_count}`);
    console.log(`  in CRM not hot:    ${summary.reverse.in_crm_not_in_hot}`);
    console.log(`  in hot not elig.:  ${summary.reverse.in_hot_not_eligible}`);
  }

  if (summary.apply_mode) {
    console.log('\nFixes applied:');
    console.log(`  hot upserted:   ${summary.fixes_applied.hot_upserted}`);
    console.log(`  hot deleted:    ${summary.fixes_applied.hot_deleted}`);
    console.log(`  ncr repaired:   ${summary.fixes_applied.ncr_repaired}`);
    console.log(`  dims refreshed: ${summary.fixes_applied.dims_refreshed}`);
    console.log(`  facts rebuilt:  ${summary.fixes_applied.facts_rebuilt}`);
  }
}
