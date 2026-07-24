import 'server-only';

import { prisma } from '@/lib/db/prisma';
import type { CallRegisterQueryParams } from './types';
import { callRegisterDateSqlExpr, isCallRegisterAllTime, parseCallRegisterDateField } from './dates';
import {
  formatSerialExportDate,
  shapeSerialExportRow,
  type CallRegisterSerialExportRow,
} from './shape';

export type { CallRegisterSerialExportRow };
export { shapeSerialExportRow } from './shape';

type LocalTxnRow = {
  client: string;
  product_serial_no: string;
  daddedon: Date | string | null;
  daddedon_raw: string | null;
  warranty_start: Date | string | null;
  warranty_start_raw: string | null;
};

type HotCallRow = {
  serial: string | null;
  account: string | null;
  call_type: string | null;
  done_at: Date | string | null;
};

async function fetchLocalSerialRows(
  clients: string[],
  params: CallRegisterQueryParams
): Promise<LocalTxnRow[]> {
  const { dateFrom, dateTo } = params;
  const dateField = parseCallRegisterDateField(params.dateField);
  const dateExpr = callRegisterDateSqlExpr(dateField);
  if (dateFrom && dateTo) {
    return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
      `SELECT client, product_serial_no, daddedon, daddedon_raw,
              warranty_start, warranty_start_raw
       FROM crm_transaction_entry
       WHERE client = ANY($1::text[])
         AND ${dateExpr} >= $2::date
         AND ${dateExpr} < ($3::date + interval '1 day')`,
      clients,
      dateFrom,
      dateTo
    );
  }
  return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
    `SELECT client, product_serial_no, daddedon, daddedon_raw,
            warranty_start, warranty_start_raw
     FROM crm_transaction_entry
     WHERE client = ANY($1::text[])`,
    clients
  );
}

async function fetchHotDoneDates(
  clients: string[]
): Promise<Map<string, { installationDate?: string; deploymentDate?: string }>> {
  const calls = await prisma.$queryRawUnsafeBulk<HotCallRow[]>(
    `SELECT serial, account, call_type, COALESCE(solved_at, logged_at) AS done_at
     FROM calls_latest_hot
     WHERE account = ANY($1::text[])
       AND serial IS NOT NULL AND serial <> ''
       AND status_bucket = 'solved'
       AND call_type IN (
         'INSTALLATION CALL', 'INSTALLATION', 'Installation', 'Installation Call',
         'DEPLOYMENT', 'Deployment', 'DEPLOYMENT CALL', 'Deployment Call'
       )`,
    clients
  );

  const map = new Map<string, { installationDate?: string; deploymentDate?: string }>();
  for (const call of calls) {
    const serial = (call.serial || '').trim();
    const account = (call.account || '').trim();
    if (!serial || !account) continue;
    const key = `${account}\0${serial}`;
    const done = formatSerialExportDate(call.done_at);
    if (!done) continue;
    const callType = (call.call_type || '').toUpperCase();
    const cur = map.get(key) || {};
    if (callType === 'INSTALLATION' || callType === 'INSTALLATION CALL') {
      if (!cur.installationDate || done < cur.installationDate) cur.installationDate = done;
    } else if (callType === 'DEPLOYMENT' || callType === 'DEPLOYMENT CALL') {
      if (!cur.deploymentDate || done < cur.deploymentDate) cur.deploymentDate = done;
    }
    map.set(key, cur);
  }
  return map;
}

export async function fetchCallRegisterSerialExportRows(
  clients: string | string[],
  params: CallRegisterQueryParams
): Promise<CallRegisterSerialExportRow[]> {
  const list = (Array.isArray(clients) ? clients : [clients])
    .map((c) => c.trim())
    .filter(Boolean);
  if (!list.length) return [];

  const [crmRows, hotMap] = await Promise.all([
    fetchLocalSerialRows(list, params),
    fetchHotDoneDates(list),
  ]);

  const out: CallRegisterSerialExportRow[] = [];
  for (const row of crmRows) {
    const serial = (row.product_serial_no || '').trim();
    const client = (row.client || '').trim();
    if (!serial || !client) continue;
    const hot = hotMap.get(`${client}\0${serial}`);
    out.push(
      shapeSerialExportRow({
        client,
        serial,
        qtyDate:
          row.warranty_start ??
          row.warranty_start_raw ??
          row.daddedon ??
          row.daddedon_raw,
        importedDate: row.daddedon ?? row.daddedon_raw,
        installationDate: hot?.installationDate,
        deploymentDate: hot?.deploymentDate,
      })
    );
  }

  out.sort((a, b) => {
    const clientCmp = a.client.localeCompare(b.client);
    if (clientCmp !== 0) return clientCmp;
    const serialCmp = a.serial.localeCompare(b.serial);
    if (serialCmp !== 0) return serialCmp;
    const toIso = (s: string) => {
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
    };
    return toIso(a.qtyDate).localeCompare(toIso(b.qtyDate));
  });
  return out;
}

export function callRegisterSerialExportFilename(
  params: CallRegisterQueryParams,
  date = new Date()
): string {
  const stamp = date.toISOString().slice(0, 10);
  if (isCallRegisterAllTime(params)) {
    return `WRL_Call_Register_Serials_AllTime_${stamp}.xlsx`;
  }
  return `WRL_Call_Register_Serials_${params.dateFrom}_${params.dateTo}.xlsx`;
}
