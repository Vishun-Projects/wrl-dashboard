/**
 * For YTD hot vs CRM status deltas: which editedon day (IST) caused them?
 *   npx tsx scripts/ops/check-ytd-delta-edit-dates.ts 2026-08-27
 */
import '@/modules/mis-email/services/bootstrap-env';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { parseCrmDate } from '@/lib/read-model/dates';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import type { HotRow, StatusBucket } from '@/lib/read-model/types';

const START = '2026-01-01';
const AS_OF = process.argv[2]?.trim() || '2026-08-27';
const SYNC_DONE_IST = '2026-08-28T02:23:00+05:30';
const IST_START = `${START}T00:00:00+05:30`;
const IST_END = `${AS_OF}T23:59:59.999+05:30`;
const BATCH = 40;
const FULL_SCAN = process.argv.includes('--full');

type IstBucket =
  | 'before_27'
  | 'on_27'
  | 'on_28_before_sync'
  | 'on_28_after_sync'
  | 'unknown';

function istDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function bucketCrmEditedon(crm: Record<string, unknown>): IstBucket {
  const edited = parseCrmDate(crm.editedon) ?? parseCrmDate(crm.addedon);
  if (!edited) return 'unknown';
  const day = istDateKey(edited);
  if (day < '2026-08-27') return 'before_27';
  if (day === '2026-08-27') return 'on_27';
  if (day === '2026-08-28') {
    return edited.getTime() < new Date(SYNC_DONE_IST).getTime()
      ? 'on_28_before_sync'
      : 'on_28_after_sync';
  }
  return 'unknown';
}

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

async function main() {
  const hotRows = await withAppClient(async (c) => {
    const bucketFilter = FULL_SCAN
      ? ''
      : ` AND status_bucket IN ('open_unallocated', 'assigned', 'tech_solved')`;
    const r = await c.query<HotRow>(
      `SELECT vtrnno, status_bucket, source_editedon, bsolved, bfastclose,
              ncancelreason, region, is_major, nengineer
       FROM calls_latest_hot
       WHERE upper(trim(call_type)) = 'BREAKDOWN'
         AND logged_at >= $1::timestamptz
         AND logged_at <= $2::timestamptz
         ${bucketFilter}
       ORDER BY vtrnno`,
      [IST_START, IST_END]
    );
    return r.rows;
  });

  console.log(`=== YTD delta edit-date check (${START} → ${AS_OF} logged, IST) ===`);
  console.log(`Scope: ${FULL_SCAN ? 'ALL hot rows' : 'open_unallocated + assigned + tech_solved only'}`);
  console.log(`Hot rows: ${hotRows.length.toLocaleString('en-IN')}`);
  console.log(`Sync finished (approx): ${SYNC_DONE_IST}\n`);

  const byEditedon: Record<IstBucket, number> = {
    before_27: 0,
    on_27: 0,
    on_28_before_sync: 0,
    on_28_after_sync: 0,
    unknown: 0,
  };
  const byPair: Record<string, number> = {};
  const openDelta: Record<IstBucket, number> = { ...byEditedon };
  const examples: string[] = [];

  let checked = 0;
  let statusMismatch = 0;
  let missingCrm = 0;
  let openishMismatch = 0;

  const OPENISH: StatusBucket[] = ['open_unallocated', 'assigned', 'tech_solved'];

  for (let i = 0; i < hotRows.length; i += BATCH) {
    const chunk = hotRows.slice(i, i + BATCH);
    const crmRows = await fetchCrmRowsByTrns(
      chunk.map((r) => r.vtrnno),
      { includeTransferred: true }
    );
    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r]));

    for (const hot of chunk) {
      checked++;
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) {
        missingCrm++;
        continue;
      }
      const fresh = transformCrmRowToHot(crm);
      const crmBucket = fresh?.status_bucket ?? '(ineligible)';
      if (crmBucket === hot.status_bucket) continue;

      statusMismatch++;
      const eb = bucketCrmEditedon(crm);
      byEditedon[eb]++;
      const pair = `${hot.status_bucket} → ${crmBucket}`;
      bump(byPair, pair);

      const hotOpenish = OPENISH.includes(hot.status_bucket);
      const crmOpenish = fresh != null && OPENISH.includes(fresh.status_bucket);
      const affectsOpenCounts = hotOpenish || crmOpenish;
      if (affectsOpenCounts) {
        openishMismatch++;
        openDelta[eb]++;
        if (examples.length < 12) {
          const edited = parseCrmDate(crm.editedon) ?? parseCrmDate(crm.addedon);
          examples.push(
            `${hot.vtrnno} hot=${hot.status_bucket} crm=${crmBucket} edited=${edited ? istDateKey(edited) + ' ' + edited.toISOString() : '?'}`
          );
        }
      }
    }

    if ((i / BATCH + 1) % 50 === 0 || i + BATCH >= hotRows.length) {
      process.stdout.write(
        `\r  … ${Math.min(i + BATCH, hotRows.length).toLocaleString('en-IN')} / ${hotRows.length.toLocaleString('en-IN')} checked, ${statusMismatch} mismatches`
      );
    }
  }
  process.stdout.write('\n');

  console.log('\n── All status mismatches (hot vs live CRM) ──');
  console.log(`Checked:           ${checked.toLocaleString('en-IN')}`);
  console.log(`Status mismatch:   ${statusMismatch.toLocaleString('en-IN')}`);
  console.log(`Missing in CRM:    ${missingCrm.toLocaleString('en-IN')}`);
  console.log(`Open-ish mismatch: ${openishMismatch.toLocaleString('en-IN')} (feeds open/assigned/tech delta)`);

  console.log('\nCRM editedon (IST) for ALL mismatches:');
  for (const [k, v] of Object.entries(byEditedon)) {
    if (v) console.log(`  ${k.padEnd(22)} ${v.toLocaleString('en-IN')}`);
  }

  console.log('\nCRM editedon (IST) for OPEN-ISH mismatches only:');
  for (const [k, v] of Object.entries(openDelta)) {
    if (v) console.log(`  ${k.padEnd(22)} ${v.toLocaleString('en-IN')}`);
  }

  console.log('\nMismatch direction (hot → crm):');
  for (const [pair, n] of Object.entries(byPair).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${pair.padEnd(35)} ${n.toLocaleString('en-IN')}`);
  }

  if (examples.length) {
    console.log('\nSample open-ish mismatches:');
    for (const line of examples) console.log(`  ${line}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
