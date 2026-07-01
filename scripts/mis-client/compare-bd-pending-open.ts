import { config } from 'dotenv';
import { join } from 'path';
import XLSX from 'xlsx';
import { withAppClient } from '@/lib/read-model/db';

config({ path: join(process.cwd(), '.env.local') });

const EXCEL = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx';

function norm(s: string): string {
  return s.trim().replace(/^0+/, '').toLowerCase();
}

function normZone(s: string): string {
  return s.trim().toUpperCase().replace(/\s+ZONE$/i, '');
}

async function main() {
  const wb = XLSX.readFile(EXCEL);
  const pending = XLSX.utils.sheet_to_json(wb.Sheets['BD pending '], {
    header: 1,
    defval: '',
  }) as unknown[][];

  const pendingByZone = new Map<string, Set<string>>();
  for (let i = 1; i < pending.length; i++) {
    const r = pending[i] as unknown[];
    const zone = normZone(String(r[0] ?? ''));
    const so = norm(String(r[5] ?? ''));
    if (!zone || !so) continue;
    if (!pendingByZone.has(zone)) pendingByZone.set(zone, new Set());
    pendingByZone.get(zone)!.add(so);
  }

  await withAppClient(async (c) => {
    for (const zone of ['NORTH', 'EAST', 'WEST', 'SOUTH']) {
      const pendingSet = pendingByZone.get(zone) ?? new Set<string>();
      const openRows = await c.query<{
        vtrnno: string;
        vcclid: string | null;
        status_label: string;
        account: string;
        logged_at: string;
      }>(
        `
        SELECT h.vtrnno, h.vcclid, h.status_label, h.account, h.logged_at::text
        FROM calls_latest_hot h
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket IN ('open_unallocated', 'assigned')
          AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE $1
        `,
        [`%${zone}%`]
      );

      const portalOpen = new Set(openRows.rows.map((r) => norm(r.vtrnno)));
      let onlyPortal = 0;
      let onlyPending = 0;
      for (const id of portalOpen) {
        if (!pendingSet.has(id)) onlyPortal++;
      }
      for (const id of pendingSet) {
        if (!portalOpen.has(id)) onlyPending++;
      }

      console.log(
        `\n${zone}: portal open ${portalOpen.size}, excel pending ${pendingSet.size}, onlyPortal ${onlyPortal}, onlyPending ${onlyPending}`
      );
      for (const r of openRows.rows.filter((row) => !pendingSet.has(norm(row.vtrnno))).slice(0, 8)) {
        console.log(`  portal-only ${r.vtrnno} ${r.status_label} ${r.account} ${r.logged_at.slice(0, 10)}`);
      }
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
