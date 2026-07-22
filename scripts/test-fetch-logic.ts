import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';
import { buildCrmTransactionQuery } from '@/features/report/lib/call-register/sql';

async function main() {
  const params = { dateFrom: '2026-07-01', dateTo: '2026-07-20' };
  
  // 1. Fetch CRM rows
  const rawSql = buildCrmTransactionQuery(params);
  console.log('CRM query:', rawSql);
  const crmRes = await postQuery({ rawSql });
  const crmRows = (crmRes.data || []) as Record<string, string>[];

  const clientMap = new Map<string, { qty: number; serials: string[] }>();
  const serialSet = new Set<string>();

  for (const row of crmRows) {
    const client = (row.Client || 'Unknown').trim();
    const serial = (row.ProductSerialNo || '').trim();

    if (!serial) continue;

    serialSet.add(serial);

    if (!clientMap.has(client)) {
      clientMap.set(client, { qty: 0, serials: [] });
    }
    const clientData = clientMap.get(client)!;
    clientData.qty++;
    clientData.serials.push(serial);
  }

  const campaColaData = clientMap.get('Reliance Campa Cola');
  console.log('Campa Cola CRM Qty in Map:', campaColaData?.qty || 0);
  console.log('Campa Cola CRM Serials count in Map:', campaColaData?.serials.length || 0);

  const allSerials = Array.from(serialSet);
  console.log('All unique serials count across all clients:', allSerials.length);

  // 2. Let's find matches in Postgres using Prisma (to avoid Supabase helper dependencies)
  console.log('Querying Postgres read-model database for matches...');
  const CHUNK_SIZE = 500;
  const postgresCalls: any[] = [];
  
  for (let i = 0; i < allSerials.length; i += CHUNK_SIZE) {
    const chunk = allSerials.slice(i, i + CHUNK_SIZE);
    const matches = await prisma.$queryRawUnsafe<any[]>(
      `SELECT serial, call_type, status_bucket, status_label
       FROM calls_latest_hot
       WHERE serial IN (${chunk.map((_, idx) => `$${idx + 1}`).join(', ')})
         AND call_type IN ('INSTALLATION', 'DEPLOYMENT', 'Installation', 'Deployment', 'INSTALLATION CALL', 'DEPLOYMENT CALL', 'Installation Call', 'Deployment Call')`
       , ...chunk
    );
    postgresCalls.push(...matches);
  }

  console.log('Total calls matched in Postgres:', postgresCalls.length);

  const serialStatus = new Map<string, { installationDone: boolean; deploymentDone: boolean }>();

  for (const call of postgresCalls) {
    const serial = (call.serial || '').trim();
    const callType = (call.call_type || '').toUpperCase();
    const statusBucket = (call.status_bucket || '').toLowerCase();
    const statusLabel = (call.status_label || '').toLowerCase();

    const isDone = statusBucket === 'solved' || statusBucket === 'completed' || statusLabel === 'completed' || statusLabel === 'solved';

    if (!isDone) continue;

    if (!serialStatus.has(serial)) {
      serialStatus.set(serial, { installationDone: false, deploymentDone: false });
    }
    
    const stat = serialStatus.get(serial)!;
    if (callType === 'INSTALLATION' || callType === 'INSTALLATION CALL') {
      stat.installationDone = true;
    } else if (callType === 'DEPLOYMENT' || callType === 'DEPLOYMENT CALL') {
      stat.deploymentDone = true;
    }
  }

  console.log('Unique serials marked done in serialStatus map:', serialStatus.size);

  // Aggregate by Client
  const rows: any[] = [];
  for (const [client, data] of Array.from(clientMap.entries())) {
    let installation = 0;
    let deployment = 0;

    for (const serial of data.serials) {
      const stat = serialStatus.get(serial);
      if (stat?.installationDone) installation++;
      if (stat?.deploymentDone) deployment++;
    }

    rows.push({
      client,
      qty: data.qty,
      installation,
      deployment,
    });
  }

  console.log('=== Aggregated Rows ===');
  console.log(rows);
}

main().catch(console.error);
