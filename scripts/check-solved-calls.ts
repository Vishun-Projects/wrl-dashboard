import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking solved installation/deployment calls for Campa Cola in calls_latest_hot ===');
  const solvedCalls = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
       AND call_type IN ('INSTALLATION CALL', 'INSTALLATION', 'Deployment', 'DEPLOYMENT', 'DEPLOYMENT CALL')
       AND status_bucket = 'solved'
     ORDER BY logged_at DESC`
  );
  console.log('Total solved installation/deployment calls for Campa Cola in DB:', solvedCalls.length);

  if (solvedCalls.length === 0) return;

  console.log('First 5 solved calls:', solvedCalls.slice(0, 5));
  console.log('Last 5 solved calls:', solvedCalls.slice(-5));

  // Let's count logged_at year/month distribution
  const dateDist: Record<string, number> = {};
  for (const c of solvedCalls) {
    const d = new Date(c.logged_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    dateDist[key] = (dateDist[key] || 0) + 1;
  }
  console.log('Logged date distribution (Year-Month):', dateDist);

  // Let's take 100 serials of these solved calls and check their details in CRM
  const sampleSerials = solvedCalls.map(c => c.serial.trim()).filter(Boolean).slice(0, 100);
  const crmRes = await postQuery({
    rawSql: `
      SELECT ProductSerialNo, Client, daddedon, InstallationDate
      FROM TransactionEntry
      WHERE ProductSerialNo IN (${sampleSerials.map(s => `'${s}'`).join(', ')})
    `
  });
  const crmRows = crmRes.data || [];
  console.log(`Out of 100 sample serials, found in CRM: ${crmRows.length}`);
  if (crmRows.length > 0) {
    console.log('Sample of CRM rows for these solved serials:');
    console.log(crmRows.slice(0, 10));

    // Let's check daddedon dates for these CRM rows
    const crmAddedDist: Record<string, number> = {};
    for (const r of crmRows) {
      const added = r.daddedon || '';
      // Extract dd/mm/yyyy
      const match = added.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (match) {
        const key = `${match[3]}-${match[2]}`;
        crmAddedDist[key] = (crmAddedDist[key] || 0) + 1;
      } else {
        crmAddedDist['unknown'] = (crmAddedDist['unknown'] || 0) + 1;
      }
    }
    console.log('CRM daddedon date distribution (Year-Month) for these solved serials:', crmAddedDist);
  }
}

main().catch(console.error);
