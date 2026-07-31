#!/usr/bin/env npx tsx
/**
 * Verify Coke/Cadbury trace plant mapping for a date range.
 * Usage: npx tsx scripts/mis-client/verify-trace-branch-mapping.ts [startDate] [endDate]
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resolveClientImportPlant } from '../../src/features/mis-import/services/client-branch-map';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const today = new Date();
const defaultStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
const defaultEnd = today.toISOString().slice(0, 10);
const startDate = process.argv[2] ?? defaultStart;
const endDate = process.argv[3] ?? defaultEnd;

const client = new pg.Client({ connectionString: databaseUrl });

type Row = {
  source_code: string;
  region: string;
  plant: string | null;
  import_state: string | null;
  office_under_branch: string | null;
  service_order: string;
  call_status: string | null;
};

const SQL = `
  WITH latest_batch AS (
    SELECT DISTINCT ON (b.source_id)
      b.source_id,
      b.batch_id
    FROM mis_client_import_batches b
    WHERE b.status = 'completed'
    ORDER BY b.source_id, b.created_at DESC
  )
  SELECT DISTINCT ON (r.source_id, r.call_key)
    s.code AS source_code,
    r.region,
    COALESCE(
      CASE
        WHEN d_mapped.ncode IS NOT NULL
          THEN d_mapped.ncode::text || ' - ' || d_mapped.vcompanyname
      END,
      NULLIF(TRIM(r.state), ''),
      NULLIF(TRIM(r.raw->>'State'), ''),
      NULLIF(TRIM(r.raw->>'Entity Name'), '')
    ) AS plant,
    COALESCE(
      NULLIF(TRIM(r.state), ''),
      NULLIF(TRIM(r.raw->>'State'), ''),
      NULLIF(TRIM(r.raw->>'Entity Name'), '')
    ) AS import_state,
    COALESCE(
      NULLIF(TRIM(r.raw->>'Town'), ''),
      NULLIF(TRIM(r.branch_label), '')
    ) AS office_under_branch,
    r.call_key AS service_order,
    r.status_label AS call_status
  FROM mis_client_import_rows r
  JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
  JOIN mis_client_sources s ON s.id = r.source_id
  LEFT JOIN mis_client_state_mappings sm
    ON sm.source_id = r.source_id
    AND lower(trim(sm.client_state)) = lower(trim(COALESCE(
      NULLIF(TRIM(r.state), ''),
      NULLIF(TRIM(r.raw->>'Entity Name'), ''),
      NULLIF(TRIM(r.raw->>'State'), '')
    )))
  LEFT JOIN dim_offices d_mapped
    ON d_mapped.ncode = NULLIF(TRIM(sm.plan_code), '')::bigint
  LEFT JOIN latest_batch lb ON lb.source_id = r.source_id
  WHERE b.status = 'completed'
    AND r.source_id IS NOT NULL
    AND s.code IN ('coke', 'cadbury')
    AND (
      (s.code IN ('coke', 'cadbury') AND b.batch_id = lb.batch_id)
      OR (s.code NOT IN ('coke', 'cadbury'))
    )
    AND r.logged_at >= $1::date
    AND r.logged_at <= ($2::date + interval '1 day' - interval '1 second')
  ORDER BY r.source_id, r.call_key, b.created_at DESC
`;

function finalPlant(row: Row): string | null {
  return resolveClientImportPlant(row.plant);
}

async function main() {
  await client.connect();
  const res = await client.query<Row>(SQL, [startDate, endDate]);
  const rows = res.rows;

  const bySource: Record<string, number> = {};
  const byBranch: Record<string, number> = {};
  const unmapped: Row[] = [];
  const unmappedStates: Record<string, number> = {};

  for (const row of rows) {
    bySource[row.source_code] = (bySource[row.source_code] ?? 0) + 1;
    const mapped = finalPlant(row);
    if (!mapped) {
      unmapped.push(row);
      const key = row.import_state?.trim() || row.plant?.trim() || '(empty)';
      unmappedStates[key] = (unmappedStates[key] ?? 0) + 1;
    } else {
      byBranch[mapped] = (byBranch[mapped] ?? 0) + 1;
    }
  }

  const mappedCount = rows.length - unmapped.length;
  const pct = rows.length ? ((mappedCount / rows.length) * 100).toFixed(1) : '0';

  console.log(`\n=== Trace branch mapping verify: ${startDate} → ${endDate} ===`);
  console.log(`Total client trace rows: ${rows.length}`);
  console.log(`By source:`, bySource);
  console.log(`Mapped to WRL branch: ${mappedCount} (${pct}%)`);
  console.log(`Unmapped: ${unmapped.length}`);

  console.log('\n--- Branch distribution (mapped) ---');
  for (const [branch, count] of Object.entries(byBranch).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)}  ${branch}`);
  }

  if (unmapped.length > 0) {
    console.log('\n--- Unmapped import_state / plant values ---');
    for (const [state, count] of Object.entries(unmappedStates).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(5)}  ${state}`);
    }
    console.log('\n--- Sample unmapped rows (up to 10) ---');
    for (const row of unmapped.slice(0, 10)) {
      console.log(
        `  ${row.source_code} #${row.service_order} region=${row.region} state=${row.import_state ?? '—'} plant=${row.plant ?? '—'} town=${row.office_under_branch ?? '—'}`
      );
    }
  } else {
    console.log('\n✓ All rows mapped to a WRL branch label.');
  }

  // Spot-check known state → branch pairs from reference table
  const expected: Record<string, string> = {
    BIHAR: '1182 - PATNA BRANCH',
    'W.B': '1154 - KOLKATA BRANCH',
    NESA: '1127 - GUWAHATI BRANCH',
    JHARKHAND: '1150 - RANCHI BRANCH',
    ORISSA: '1176 - BHUBANESWAR BRANCH',
    'A.P': '1181 - VIJAYAWADA BRANCH',
    DELHI: '1173 - DELHI BRANCH',
    HARYANA: '1167 - LUDHIANA BRANCH',
    KARNATAKA: '1152 - BANGALORE BRANCH',
    KERALA: '1157 - COCHIN BRANCH',
    RAJASTHAN: '1163 - JAIPUR BRANCH',
    'T.N': '1159 - CHENNAI BRANCH',
    PONDICHERRY: '1159 - CHENNAI BRANCH',
    'J&K': '1164 - JAMMU BRANCH',
  };

  console.log('\n--- State → branch spot checks (rows with that import_state) ---');
  let spotFailures = 0;
  for (const [state, wantBranch] of Object.entries(expected)) {
    const sample = rows.filter(
      (r) => r.import_state?.trim().toUpperCase() === state.toUpperCase()
    );
    if (!sample.length) continue;
    const wrong = sample.filter((r) => finalPlant(r) !== wantBranch);
    const ok = sample.length - wrong.length;
    const status = wrong.length === 0 ? 'OK' : 'MISMATCH';
    console.log(
      `  ${status.padEnd(8)} ${state.padEnd(12)} ${ok}/${sample.length} → ${wantBranch}${wrong.length ? ` (${wrong.length} wrong)` : ''}`
    );
    if (wrong.length) {
      spotFailures += wrong.length;
      const ex = wrong[0];
      console.log(
        `           example: #${ex.service_order} got ${finalPlant(ex) ?? '—'} (plant raw=${ex.plant})`
      );
    }
  }

  if (spotFailures > 0) {
    console.log(`\n✗ ${spotFailures} spot-check mismatches`);
    process.exit(1);
  }
  if (unmapped.length > 0) {
    console.log(`\n⚠ ${unmapped.length} rows have no branch mapping (see list above)`);
    process.exit(0);
  }
  console.log('\n✓ Verification passed for current range.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.end());
