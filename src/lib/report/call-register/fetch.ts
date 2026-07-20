import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { isCallRegisterAllTime } from './dates';
import type { CallRegisterQueryParams, CallRegisterRow, CallRegisterSummary } from './types';

const CHUNK_SIZE = 200;

type LocalTxnRow = {
  client: string;
  product_serial_no: string;
};

async function fetchLocalTransactionRows(
  params: CallRegisterQueryParams
): Promise<LocalTxnRow[]> {
  const { dateFrom, dateTo, client } = params;

  if (client) {
    if (dateFrom && dateTo) {
      return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
        `SELECT client, product_serial_no
         FROM crm_transaction_entry
         WHERE client = $1
           AND daddedon >= $2::date
           AND daddedon < ($3::date + interval '1 day')`,
        client,
        dateFrom,
        dateTo
      );
    }
    return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
      `SELECT client, product_serial_no FROM crm_transaction_entry WHERE client = $1`,
      client
    );
  }

  if (dateFrom && dateTo) {
    return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
      `SELECT client, product_serial_no
       FROM crm_transaction_entry
       WHERE daddedon >= $1::date
         AND daddedon < ($2::date + interval '1 day')`,
      dateFrom,
      dateTo
    );
  }

  return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
    `SELECT client, product_serial_no FROM crm_transaction_entry`
  );
}

export async function listCallRegisterClients(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafeBulk<{ client: string }[]>(
    `SELECT DISTINCT client FROM crm_transaction_entry ORDER BY client`
  );
  return rows.map((r) => r.client).filter(Boolean);
}

export async function fetchCallRegisterRows(
  params: CallRegisterQueryParams
): Promise<{ rows: CallRegisterRow[]; summary: CallRegisterSummary }> {
  const isAllTime = isCallRegisterAllTime(params);

  if (isAllTime) {
    const crmData = await prisma.$queryRawUnsafeBulk<{ client: string; qty: string | number }[]>(
      `SELECT client, COUNT(*)::int AS qty
       FROM crm_transaction_entry
       GROUP BY client
       ORDER BY client`
    );

    const clients = crmData.map((r) => (r.client || '').trim()).filter(Boolean);
    const supabase = await createClient();
    const supPromises = [];

    for (const c of clients) {
      supPromises.push(
        supabase
          .from('calls_latest_hot')
          .select('*', { count: 'exact', head: true })
          .eq('account', c)
          .in('call_type', ['INSTALLATION CALL', 'INSTALLATION', 'Installation', 'Installation Call'])
          .in('status_bucket', ['solved'])
          .then(({ count }) => ({ client: c, type: 'Installation', count: count || 0 }))
      );
      supPromises.push(
        supabase
          .from('calls_latest_hot')
          .select('*', { count: 'exact', head: true })
          .eq('account', c)
          .in('call_type', ['DEPLOYMENT', 'Deployment', 'DEPLOYMENT CALL', 'Deployment Call'])
          .in('status_bucket', ['solved'])
          .then(({ count }) => ({ client: c, type: 'Deployment', count: count || 0 }))
      );
    }

    const supResults = await Promise.all(supPromises);
    const rows: CallRegisterRow[] = [];
    let totalQty = 0;
    let totalInstallation = 0;
    let totalDeployment = 0;

    for (const row of crmData) {
      const clientName = (row.client || 'Unknown').trim();
      const qty = Number(row.qty || 0);
      const installCount =
        supResults.find((r) => r.client === clientName && r.type === 'Installation')?.count || 0;
      const deployCount =
        supResults.find((r) => r.client === clientName && r.type === 'Deployment')?.count || 0;

      totalQty += qty;
      totalInstallation += installCount;
      totalDeployment += deployCount;

      rows.push({
        client: clientName,
        qty,
        installation: installCount,
        deployment: deployCount,
        balanceInstallation: qty - installCount,
        balanceDeployment: qty - deployCount,
      });
    }

    return {
      rows,
      summary: {
        totalQty,
        totalInstallation,
        totalDeployment,
        totalBalanceInstallation: totalQty - totalInstallation,
        totalBalanceDeployment: totalQty - totalDeployment,
      },
    };
  }

  const crmRows = await fetchLocalTransactionRows(params);

  if (crmRows.length === 0) {
    return {
      rows: [],
      summary: {
        totalQty: 0,
        totalInstallation: 0,
        totalDeployment: 0,
        totalBalanceInstallation: 0,
        totalBalanceDeployment: 0,
      },
    };
  }

  const serialSet = new Set<string>();
  const clientMap = new Map<string, { qty: number; serials: string[] }>();

  for (const row of crmRows) {
    const clientName = (row.client || 'Unknown').trim();
    const serial = (row.product_serial_no || '').trim();
    if (!serial) continue;

    serialSet.add(serial);
    if (!clientMap.has(clientName)) {
      clientMap.set(clientName, { qty: 0, serials: [] });
    }
    const clientData = clientMap.get(clientName)!;
    clientData.qty++;
    clientData.serials.push(serial);
  }

  const allSerials = Array.from(serialSet);
  const supabase = await createClient();
  const postgresCalls: Record<string, any>[] = [];

  const serialChunks: string[][] = [];
  for (let i = 0; i < allSerials.length; i += CHUNK_SIZE) {
    serialChunks.push(allSerials.slice(i, i + CHUNK_SIZE));
  }

  const BATCH_SIZE = 3;
  for (let i = 0; i < serialChunks.length; i += BATCH_SIZE) {
    const batchChunks = serialChunks.slice(i, i + BATCH_SIZE);
    const batchPromises = batchChunks.map((chunk) =>
      supabase
        .from('calls_latest_hot')
        .select('serial, call_type, status_bucket, status_label')
        .in('serial', chunk)
        .in('call_type', [
          'INSTALLATION',
          'DEPLOYMENT',
          'Installation',
          'Deployment',
          'INSTALLATION CALL',
          'DEPLOYMENT CALL',
          'Installation Call',
          'Deployment Call',
        ])
    );

    const results = await Promise.all(batchPromises);
    for (const { data, error } of results) {
      if (error) {
        console.error('[call-register] Supabase fetch error:', error);
        throw error;
      }
      if (data) postgresCalls.push(...data);
    }
  }

  const serialStatus = new Map<string, { installationDone: boolean; deploymentDone: boolean }>();

  for (const call of postgresCalls) {
    const serial = (call.serial || '').trim();
    const callType = (call.call_type || '').toUpperCase();
    const statusBucket = (call.status_bucket || '').toLowerCase();
    const statusLabel = (call.status_label || '').toLowerCase();
    const isDone =
      statusBucket === 'solved' ||
      statusBucket === 'completed' ||
      statusLabel === 'completed' ||
      statusLabel === 'solved';
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

  const rows: CallRegisterRow[] = [];
  let totalQty = 0;
  let totalInstallation = 0;
  let totalDeployment = 0;

  for (const [clientName, data] of Array.from(clientMap.entries())) {
    let installation = 0;
    let deployment = 0;
    for (const serial of data.serials) {
      const stat = serialStatus.get(serial);
      if (stat?.installationDone) installation++;
      if (stat?.deploymentDone) deployment++;
    }

    totalQty += data.qty;
    totalInstallation += installation;
    totalDeployment += deployment;

    rows.push({
      client: clientName,
      qty: data.qty,
      installation,
      deployment,
      balanceInstallation: data.qty - installation,
      balanceDeployment: data.qty - deployment,
    });
  }

  rows.sort((a, b) => a.client.localeCompare(b.client));

  return {
    rows,
    summary: {
      totalQty,
      totalInstallation,
      totalDeployment,
      totalBalanceInstallation: totalQty - totalInstallation,
      totalBalanceDeployment: totalQty - totalDeployment,
    },
  };
}
