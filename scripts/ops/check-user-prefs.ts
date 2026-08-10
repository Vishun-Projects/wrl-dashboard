import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '../../src/lib/db/prisma';

async function main() {
  console.log('Deactivating routing rule 66cbbf16-85de-45e3-97d7-f864767e2ba4...');
  await prisma.$executeRawUnsafe(
    `UPDATE public.mis_email_routing_rules 
     SET auto_send_enabled = false 
     WHERE id = $1`,
    '66cbbf16-85de-45e3-97d7-f864767e2ba4'
  );

  console.log('Verification: fetching all routing rules...');
  const rules = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, zone, branch, client, schedule_anchor_time_ist, auto_send_enabled 
     FROM public.mis_email_routing_rules`
  );

  for (const r of rules) {
    console.log(`- Rule ID: ${r.id}, Anchor Time: ${r.schedule_anchor_time_ist}, Auto-Send Enabled: ${r.auto_send_enabled}`);
  }
}

main().catch(console.error);
