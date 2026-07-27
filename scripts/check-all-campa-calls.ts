import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking all Campa Cola calls in calls_latest_hot ===');
  const allCalls = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
     ORDER BY logged_at DESC`
  );
  console.log('Total calls for Campa Cola in DB:', allCalls.length);

  if (allCalls.length === 0) return;

  const dateDist: Record<string, number> = {};
  const statusDist: Record<string, number> = {};
  const typeDist: Record<string, number> = {};

  for (const c of allCalls) {
    const d = new Date(c.logged_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    dateDist[key] = (dateDist[key] || 0) + 1;

    statusDist[c.status_bucket] = (statusDist[c.status_bucket] || 0) + 1;
    typeDist[c.call_type] = (typeDist[c.call_type] || 0) + 1;
  }

  console.log('Logged date distribution (Year-Month) for ALL calls:', dateDist);
  console.log('Status bucket distribution:', statusDist);
  console.log('Call type distribution:', typeDist);

  // Let's look at the calls in July 2026
  const julyCalls = allCalls.filter(c => {
    const d = new Date(c.logged_at);
    return d.getFullYear() === 2026 && d.getMonth() === 6; // July
  });
  console.log('Total calls in July 2026:', julyCalls.length);
  console.log('Sample July calls (first 20):');
  console.log(julyCalls.slice(0, 20));
}

main().catch(console.error);
