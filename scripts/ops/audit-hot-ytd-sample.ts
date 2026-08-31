/**
 * Stratified YTD hot vs CRM column audit (read-only sample).
 *   npx tsx scripts/ops/audit-hot-ytd-sample.ts
 *   npx tsx scripts/ops/audit-hot-ytd-sample.ts 2026-08-27 200
 */
import '@/modules/mis-email/services/bootstrap-env';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import {
  diffHotRow,
  normalizeHotRowFromDb,
  HOT_AUDIT_COLUMNS,
} from '@/lib/read-model/audit/compare-hot';
import type { HotRow, StatusBucket } from '@/lib/read-model/types';

const START = '2026-01-01';
const AS_OF = process.argv[2]?.trim() || '2026-08-27';
const PER_BUCKET = Math.max(20, Number(process.argv[3] ?? 150) || 150);
const IST_START = `${START}T00:00:00+05:30`;
const IST_END = `${AS_OF}T23:59:59.999+05:30`;
const BUCKETS: StatusBucket[] = [
  'open_unallocated',
  'assigned',
  'tech_solved',
  'solved',
  'cancelled',
];
const EXTRA_COLS = ['cancel_reason', 'cancelled_at', 'arcp_bm_approved_at'] as const;

function fmt(v: unknown): string {
  if (v == null) return 'null';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function extraDiff(hot: HotRow, expected: HotRow): string[] {
  const out: string[] = [];
  if (fmt(hot.cancel_reason) !== fmt(expected.cancel_reason)) {
    out.push(`cancel_reason hot=${fmt(hot.cancel_reason)} crm=${fmt(expected.cancel_reason)}`);
  }
  if (fmt(hot.cancelled_at) !== fmt(expected.cancelled_at)) {
    out.push(`cancelled_at hot=${fmt(hot.cancelled_at)} crm=${fmt(expected.cancelled_at)}`);
  }
  if (fmt(hot.arcp_bm_approved_at) !== fmt(expected.arcp_bm_approved_at)) {
    out.push(
      `arcp_bm_approved_at hot=${fmt(hot.arcp_bm_approved_at)} crm=${fmt(expected.arcp_bm_approved_at)}`
    );
  }
  return out;
}

async function main() {
  console.log(`=== YTD hot vs CRM column audit (sample) ===`);
  console.log(`Logged ${START} → ${AS_OF} | ${PER_BUCKET} rows per status_bucket`);
  console.log(`Columns checked: ${HOT_AUDIT_COLUMNS.join(', ')}, ${EXTRA_COLS.join(', ')}\n`);

  const samples = await withAppClient(async (c) => {
    const all: Record<string, unknown>[] = [];
    for (const bucket of BUCKETS) {
      const r = await c.query(
        `SELECT * FROM calls_latest_hot
         WHERE upper(trim(call_type)) = 'BREAKDOWN'
           AND logged_at >= $1 AND logged_at <= $2
           AND status_bucket = $3::status_bucket_type
         ORDER BY random()
         LIMIT $4`,
        [IST_START, IST_END, bucket, PER_BUCKET]
      );
      all.push(...r.rows);
    }
    return all;
  });

  console.log(`Sample size: ${samples.length}\n`);

  let checked = 0;
  let exact = 0;
  let mismatchRows = 0;
  let missingCrm = 0;
  let shouldNotExist = 0;
  const byColumn: Record<string, number> = {};
  const examples: string[] = [];

  for (let i = 0; i < samples.length; i += 40) {
    const chunk = samples.slice(i, i + 40);
    const trns = chunk.map((r) => String(r.vtrnno).trim());
    const crmRows = await fetchCrmRowsByTrns(trns, { includeTransferred: true });
    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r]));

    for (const raw of chunk) {
      checked++;
      const trn = String(raw.vtrnno).trim();
      const hot = normalizeHotRowFromDb(raw);
      const crm = crmByTrn.get(trn);

      if (!crm) {
        missingCrm++;
        if (examples.length < 8) examples.push(`${trn}: missing in CRM`);
        continue;
      }

      const expected = transformCrmRowToHot(crm);
      if (!expected) {
        shouldNotExist++;
        if (examples.length < 8) examples.push(`${trn}: should not exist in hot (transferred/ineligible)`);
        continue;
      }

      const cols = diffHotRow(hot, expected);
      const extra = extraDiff(hot, expected);
      if (!cols.length && !extra.length) {
        exact++;
        continue;
      }

      mismatchRows++;
      for (const c of cols) byColumn[c.column] = (byColumn[c.column] ?? 0) + 1;
      if (examples.length < 12) {
        const bits = [
          ...cols.slice(0, 4).map((c) => `${c.column}: hot=${fmt(c.hot_value)} crm=${fmt(c.expected_value)}`),
          ...extra.slice(0, 2),
        ];
        examples.push(`${trn} [${hot.status_bucket}]: ${bits.join('; ')}`);
      }
    }
    process.stdout.write(`\r  checked ${Math.min(i + 40, samples.length)}/${samples.length}`);
  }
  process.stdout.write('\n');

  const pct = checked ? ((exact / checked) * 100).toFixed(2) : '0';
  console.log('\n── Results ──');
  console.log(`Checked:              ${checked}`);
  console.log(`Exact match:          ${exact} (${pct}%)`);
  console.log(`Column mismatches:    ${mismatchRows}`);
  console.log(`Missing in CRM:       ${missingCrm}`);
  console.log(`Should not be in hot: ${shouldNotExist}`);

  if (Object.keys(byColumn).length) {
    console.log('\nMismatches by column:');
    for (const [col, n] of Object.entries(byColumn).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${col.padEnd(22)} ${n}`);
    }
  }

  if (examples.length) {
    console.log('\nExamples:');
    for (const line of examples) console.log(`  ${line}`);
  }

  console.log(
    `\nNote: sample only — run full audit for all YTD rows:\n` +
      `  npx tsx src/lib/read-model/cli.ts full-audit --only hot --ytd-only`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
