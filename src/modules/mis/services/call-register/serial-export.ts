import 'server-only';

import { prisma } from '@/lib/db/prisma';
import type { CallRegisterQueryParams } from './types';
import {
  callRegisterDateSqlExpr,
  parseCallRegisterDateField,
} from './dates';
import {
  shapeSerialExportRow,
  type CallRegisterSerialExportRow,
} from './shape';

export { shapeSerialExportRow } from './shape';
export { callRegisterSerialExportFilename } from './dates';

type ExportJoinRow = {
  client: string;
  product_serial_no: string;
  daddedon: Date | string | null;
  daddedon_raw: string | null;
  warranty_start: Date | string | null;
  warranty_start_raw: string | null;
  installation_done: Date | string | null;
  deployment_done: Date | string | null;
};

/**
 * One round-trip: billed serials + install/deploy dates only for those serials.
 * (Previously pulled every solved install/deploy call for the account — huge for Nestle/etc.)
 */
async function fetchExportJoinRows(
  clients: string[],
  params: CallRegisterQueryParams
): Promise<ExportJoinRow[]> {
  const { dateFrom, dateTo } = params;
  const dateField = parseCallRegisterDateField(params.dateField);
  const dateExpr = callRegisterDateSqlExpr(dateField, 't');

  const dateClause =
    dateFrom && dateTo
      ? `AND ${dateExpr} >= $2::date
         AND ${dateExpr} < ($3::date + interval '1 day')`
      : '';
  const args: unknown[] =
    dateFrom && dateTo ? [clients, dateFrom, dateTo] : [clients];

  return prisma.$queryRawUnsafeBulk<ExportJoinRow[]>(
    `WITH billed AS (
       SELECT
         btrim(t.client) AS client,
         btrim(t.product_serial_no) AS product_serial_no,
         t.daddedon,
         t.daddedon_raw,
         t.warranty_start,
         t.warranty_start_raw
       FROM crm_transaction_entry t
       WHERE t.client = ANY($1::text[])
         AND NULLIF(btrim(t.product_serial_no), '') IS NOT NULL
         ${dateClause}
     ),
     billed_keys AS (
       SELECT DISTINCT client, product_serial_no AS serial FROM billed
     ),
     hot AS (
       SELECT
         btrim(h.account) AS account,
         btrim(h.serial) AS serial,
         MIN(COALESCE(h.solved_at, h.logged_at)) FILTER (
           WHERE upper(btrim(h.call_type)) IN ('INSTALLATION', 'INSTALLATION CALL')
         ) AS installation_done,
         MIN(COALESCE(h.solved_at, h.logged_at)) FILTER (
           WHERE upper(btrim(h.call_type)) IN ('DEPLOYMENT', 'DEPLOYMENT CALL')
         ) AS deployment_done
       FROM calls_latest_hot h
       INNER JOIN billed_keys k
         ON k.client = btrim(h.account)
        AND k.serial = btrim(h.serial)
       WHERE h.status_bucket = 'solved'
         AND NULLIF(btrim(h.serial), '') IS NOT NULL
       GROUP BY 1, 2
     )
     SELECT
       b.client,
       b.product_serial_no,
       b.daddedon,
       b.daddedon_raw,
       b.warranty_start,
       b.warranty_start_raw,
       h.installation_done,
       h.deployment_done
     FROM billed b
     LEFT JOIN hot h
       ON h.account = b.client
      AND h.serial = b.product_serial_no
     ORDER BY b.client, b.product_serial_no`,
    ...args
  );
}

export async function fetchCallRegisterSerialExportRows(
  clients: string | string[],
  params: CallRegisterQueryParams
): Promise<CallRegisterSerialExportRow[]> {
  const list = (Array.isArray(clients) ? clients : [clients])
    .map((c) => c.trim())
    .filter(Boolean);
  if (!list.length) return [];

  const joined = await fetchExportJoinRows(list, params);
  const out: CallRegisterSerialExportRow[] = [];
  for (const row of joined) {
    const serial = (row.product_serial_no || '').trim();
    const client = (row.client || '').trim();
    if (!serial || !client) continue;
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
        installationDate: row.installation_done,
        deploymentDate: row.deployment_done,
      })
    );
  }
  return out;
}
