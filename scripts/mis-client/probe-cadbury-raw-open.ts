import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
config({ path: join(process.cwd(), '.env.local') });

import { queryClientAccountSummaryForBdMis } from '@/lib/mis-client-import/aggregate';
import { parseClientDate } from '@/lib/mis-client-import/parse-dates';
import { isCadburyExcludedServiceProvider } from '@/lib/mis-client-import/cadbury-filters';
import { formatDisplayRegion } from '@/lib/mis-client-import/region';
import { openCallsFromTotals } from '@/lib/report/bd-mis-summary';
import { withAppClient } from '@/lib/read-model/db';

const END = '2026-06-29';

function countRawCadburyOpen(rawPath: string): Map<string, number> {
  const text = readFileSync(rawPath, 'utf16le').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split('|').map((h) => h.replace(/^"|"$/g, '').replace(/^\./, ''));
  const openByZone = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('|').map((c) => c.replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cols[j] ?? '';
    });
    const d = parseClientDate(row.VDate ?? '');
    if (!d || d < new Date('2026-01-01') || d > new Date(`${END}T23:59:59`)) continue;
    if (isCadburyExcludedServiceProvider(row.Service_Provider ?? '')) continue;
    const st = (row.Status ?? row.Call_Status ?? '').trim().toLowerCase();
    const isOpen =
      st.includes('assigned') ||
      st.includes('open') ||
      st === 'pending' ||
      st.includes('wip');
    const isSolved =
      st.includes('closed') ||
      st.includes('solved') ||
      st.includes('done') ||
      st.includes('complete');
    if (!isOpen || isSolved) continue;
    const zone = formatDisplayRegion(row.Region ?? row.ASM_Name ?? 'UNKNOWN');
    openByZone.set(zone, (openByZone.get(zone) ?? 0) + 1);
  }
  return openByZone;
}

async function main() {
  const rawOpen = countRawCadburyOpen('C:/Users/Vishnu.Vishwakarma/Downloads/Raw/Cadbury.csv');
  const client = await queryClientAccountSummaryForBdMis({
    startDate: '2026-01-01',
    endDate: END,
    agingAsOf: END,
    sourceCodes: ['cadbury'],
  });

  console.log('Cadbury client open — raw CSV vs DB import:');
  for (const zone of ['NORTH ZONE', 'EAST ZONE', 'SOUTH ZONE']) {
    const db = client.find(
      (a) => formatDisplayRegion(a.region) === zone && (a.account ?? '').toLowerCase() === 'cadbury'
    );
    const dbOpen = db ? openCallsFromTotals(db) : 0;
    const raw = rawOpen.get(zone) ?? 0;
    console.log(`  ${zone}: raw=${raw} db=${dbOpen} Δ=${dbOpen - raw}`);
  }

  await withAppClient(async (c) => {
    const r = await c.query(`
      SELECT r.region, r.status_bucket, count(*)::int n
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code = 'cadbury' AND b.status = 'completed'
        AND b.batch_id = (
          SELECT batch_id FROM mis_client_import_batches
          WHERE source_id = s.id AND status = 'completed'
          ORDER BY created_at DESC LIMIT 1
        )
        AND r.status_bucket IN ('open_unallocated','assigned')
        AND r.logged_at >= '2026-01-01' AND r.logged_at <= '2026-06-29T23:59:59'
      GROUP BY 1, 2 ORDER BY 1
    `);
    console.log('\nDB cadbury open by region:', r.rows);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
