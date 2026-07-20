import 'server-only';

import { prisma } from '@/lib/db/prisma';
import type { CallRegisterClient } from './sql';
import type { CallRegisterQueryParams } from './types';
import { isCallRegisterAllTime } from './dates';
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
};

type HotCallRow = {
  serial: string | null;
  call_type: string | null;
  done_at: Date | string | null;
};

async function fetchLocalSerialRows(
  client: CallRegisterClient,
  params: CallRegisterQueryParams
): Promise<LocalTxnRow[]> {
  const { dateFrom, dateTo } = params;
  if (dateFrom && dateTo) {
    return prisma.$queryRawUnsafeBulk<LocalTxnRow[]>(
      `SELECT client, product_serial_no, daddedon, daddedon_raw
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
    `SELECT client, product_serial_no, daddedon, daddedon_raw
     FROM crm_transaction_entry
     WHERE client = $1`,
    client
  );
}

async function fetchHotDoneDates(client: CallRegisterClient): Promise<
  Map<string, { installationDate?: string; deploymentDate?: string }>
> {
  const calls = await prisma.$queryRawUnsafeBulk<HotCallRow[]>(
    `SELECT serial, call_type, COALESCE(solved_at, logged_at) AS done_at
     FROM calls_latest_hot
     WHERE account = $1
       AND serial IS NOT NULL AND serial <> ''
       AND status_bucket = 'solved'
       AND call_type IN (
         'INSTALLATION CALL', 'INSTALLATION', 'Installation', 'Installation Call',
         'DEPLOYMENT', 'Deployment', 'DEPLOYMENT CALL', 'Deployment Call'
       )`,
    client
  );

  const map = new Map<string, { installationDate?: string; deploymentDate?: string }>();
  for (const call of calls) {
    const serial = (call.serial || '').trim();
    if (!serial) continue;
    const done = formatSerialExportDate(call.done_at);
    if (!done) continue;
    const callType = (call.call_type || '').toUpperCase();
    const cur = map.get(serial) || {};
    if (callType === 'INSTALLATION' || callType === 'INSTALLATION CALL') {
      if (!cur.installationDate || done < cur.installationDate) cur.installationDate = done;
    } else if (callType === 'DEPLOYMENT' || callType === 'DEPLOYMENT CALL') {
      if (!cur.deploymentDate || done < cur.deploymentDate) cur.deploymentDate = done;
    }
    map.set(serial, cur);
  }
  return map;
}

export async function fetchCallRegisterSerialExportRows(
  client: CallRegisterClient,
  params: CallRegisterQueryParams
): Promise<CallRegisterSerialExportRow[]> {
  const [crmRows, hotMap] = await Promise.all([
    fetchLocalSerialRows(client, params),
    fetchHotDoneDates(client),
  ]);

  const out: CallRegisterSerialExportRow[] = [];
  for (const row of crmRows) {
    const serial = (row.product_serial_no || '').trim();
    if (!serial) continue;
    const hot = hotMap.get(serial);
    out.push(
      shapeSerialExportRow({
        client: (row.client || client).trim(),
        serial,
        qtyDate: row.daddedon ?? row.daddedon_raw,
        installationDate: hot?.installationDate,
        deploymentDate: hot?.deploymentDate,
      })
    );
  }

  out.sort((a, b) => a.serial.localeCompare(b.serial) || a.qtyDate.localeCompare(b.qtyDate));
  return out;
}

export function callRegisterSerialExportFilename(
  client: CallRegisterClient,
  params: CallRegisterQueryParams,
  date = new Date()
): string {
  const safeClient = client.replace(/[^\w]+/g, '_');
  const stamp = date.toISOString().slice(0, 10);
  if (isCallRegisterAllTime(params)) {
    return `WRL_Call_Register_Serials_${safeClient}_AllTime_${stamp}.xlsx`;
  }
  return `WRL_Call_Register_Serials_${safeClient}_${params.dateFrom}_${params.dateTo}.xlsx`;
}
