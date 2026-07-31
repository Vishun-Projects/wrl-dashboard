import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { queryClientAccountSummaryFiltered } from '@/modules/mis/client-import/services/aggregate';
import { formatDisplayRegion } from '@/modules/mis/client-import/services/region';

async function main() {
  const client = await queryClientAccountSummaryFiltered({
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    sourceCodes: ['coke', 'cadbury'],
  });

  const byReg = new Map<string, { cadbury: number; coke: number }>();
  for (const r of client) {
    const z = formatDisplayRegion(String(r.region));
    const acc = String(r.account).toLowerCase();
    if (!byReg.has(z)) byReg.set(z, { cadbury: 0, coke: 0 });
    const b = byReg.get(z)!;
    if (acc === 'cadbury') b.cadbury += Number(r.total_calls ?? 0);
    if (acc === 'coke') b.coke += Number(r.total_calls ?? 0);
  }

  const ref: Record<string, { c: number; h: number }> = {
    'NORTH ZONE': { c: 11636, h: 0 },
    'EAST ZONE': { c: 18161, h: 0 },
    'WEST ZONE': { c: 0, h: 0 },
    'SOUTH ZONE': { c: 12873, h: 30515 },
  };

  console.log('Client import vs Excel Mondelez/HCCB:');
  for (const z of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
    const a = byReg.get(z) ?? { cadbury: 0, coke: 0 };
    const r = ref[z];
    console.log(
      `  ${z}: cadbury ${a.cadbury} (ref ${r.c}, Δ${a.cadbury - r.c}) | coke ${a.coke} (ref ${r.h}, Δ${a.coke - r.h})`
    );
  }
}

main().catch(console.error);
