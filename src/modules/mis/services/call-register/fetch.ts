import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { listVisibleCallRegisterClients } from '@/lib/call/register/visible-clients';
import { callRegisterDateSqlExpr, parseCallRegisterDateField } from './dates';
import type { CallRegisterQueryParams, CallRegisterRow, CallRegisterSummary } from './types';

const HOT_DONE = `(
  h.status_bucket::text IN ('solved', 'completed')
  OR LOWER(COALESCE(h.status_label, '')) IN ('solved', 'completed')
)`;

function ensureAllowlistGridRows(
  rows: CallRegisterRow[],
  allowlist: string[]
): CallRegisterRow[] {
  const byClient = new Map(rows.map((r) => [r.client, r]));
  return allowlist.map(
    (client) =>
      byClient.get(client) ?? {
        client,
        qty: 0,
        installation: 0,
        deployment: 0,
        balanceInstallation: 0,
        balanceDeployment: 0,
      }
  );
}

type AggregateRow = {
  client: string;
  qty: number;
  installation: number;
  deployment: number;
};

/**
 * Grid aggregates for a fixed client allowlist.
 * Join-based (not per-serial correlated EXISTS) — same shape, much cheaper.
 */
async function fetchAggregatedRows(
  params: CallRegisterQueryParams,
  allowlist: string[]
): Promise<AggregateRow[]> {
  if (!allowlist.length) return [];

  const { dateFrom, dateTo } = params;
  const dateField = parseCallRegisterDateField(params.dateField);
  const dateExpr = callRegisterDateSqlExpr(dateField, 't');
  const dateClause =
    dateFrom && dateTo
      ? `AND ${dateExpr} >= $2::date
         AND ${dateExpr} < ($3::date + interval '1 day')`
      : '';
  const args: unknown[] =
    dateFrom && dateTo ? [allowlist, dateFrom, dateTo] : [allowlist];

  return prisma.$queryRawUnsafeBulk<AggregateRow[]>(
    `WITH billed AS (
       SELECT
         btrim(t.client) AS client,
         btrim(t.product_serial_no) AS serial
       FROM crm_transaction_entry t
       WHERE t.client = ANY($1::text[])
         AND NULLIF(btrim(t.product_serial_no), '') IS NOT NULL
         ${dateClause}
     ),
     billed_keys AS (
       SELECT DISTINCT client, serial FROM billed
     ),
     hot AS (
       SELECT
         btrim(h.account) AS account,
         btrim(h.serial) AS serial,
         BOOL_OR(
           UPPER(btrim(h.call_type)) IN ('INSTALLATION', 'INSTALLATION CALL')
           AND ${HOT_DONE}
         ) AS has_install,
         BOOL_OR(
           UPPER(btrim(h.call_type)) IN ('DEPLOYMENT', 'DEPLOYMENT CALL')
           AND ${HOT_DONE}
         ) AS has_deploy
       FROM calls_latest_hot h
       INNER JOIN billed_keys k
         ON k.client = btrim(h.account)
        AND k.serial = btrim(h.serial)
       WHERE NULLIF(btrim(h.serial), '') IS NOT NULL
       GROUP BY 1, 2
     )
     SELECT
       b.client,
       COUNT(*)::int AS qty,
       COUNT(*) FILTER (WHERE COALESCE(h.has_install, false))::int AS installation,
       COUNT(*) FILTER (WHERE COALESCE(h.has_deploy, false))::int AS deployment
     FROM billed b
     LEFT JOIN hot h
       ON h.account = b.client
      AND h.serial = b.serial
     GROUP BY b.client
     ORDER BY b.client`,
    ...args
  );
}

/** Cheap name list for editor dropdowns — no install/deploy counting. */
async function listDistinctClientsInRange(
  params: CallRegisterQueryParams
): Promise<string[]> {
  const { dateFrom, dateTo } = params;
  const dateField = parseCallRegisterDateField(params.dateField);
  const dateExpr = callRegisterDateSqlExpr(dateField, 't');

  if (dateFrom && dateTo) {
    const rows = await prisma.$queryRawUnsafeBulk<{ client: string }[]>(
      `SELECT DISTINCT btrim(t.client) AS client
       FROM crm_transaction_entry t
       WHERE NULLIF(btrim(t.client), '') IS NOT NULL
         AND ${dateExpr} >= $1::date
         AND ${dateExpr} < ($2::date + interval '1 day')
       ORDER BY 1`,
      dateFrom,
      dateTo
    );
    return rows.map((r) => r.client).filter(Boolean);
  }

  const rows = await prisma.$queryRawUnsafeBulk<{ client: string }[]>(
    `SELECT DISTINCT btrim(t.client) AS client
     FROM crm_transaction_entry t
     WHERE NULLIF(btrim(t.client), '') IS NOT NULL
     ORDER BY 1`
  );
  return rows.map((r) => r.client).filter(Boolean);
}

export async function listCallRegisterClients(): Promise<string[]> {
  return listVisibleCallRegisterClients();
}

export async function fetchCallRegisterRows(
  params: CallRegisterQueryParams & { allClients?: boolean }
): Promise<{
  rows: CallRegisterRow[];
  summary: CallRegisterSummary;
  sharedClients: string[];
  /** Full dynamic names for editor dropdowns only (no counts). */
  clientOptions: string[] | null;
}> {
  const wantOptions = Boolean(params.allClients);
  const sharedClients = await listVisibleCallRegisterClients();

  const [aggregated, clientOptions] = await Promise.all([
    fetchAggregatedRows(params, sharedClients),
    wantOptions ? listDistinctClientsInRange(params) : Promise.resolve(null),
  ]);

  const mapped = aggregated.map((row) => {
    const qty = Number(row.qty || 0);
    const installation = Number(row.installation || 0);
    const deployment = Number(row.deployment || 0);
    return {
      client: row.client,
      qty,
      installation,
      deployment,
      balanceInstallation: qty - installation,
      balanceDeployment: qty - deployment,
    };
  });

  const rows = ensureAllowlistGridRows(mapped, sharedClients);

  let totalQty = 0;
  let totalInstallation = 0;
  let totalDeployment = 0;
  for (const row of rows) {
    totalQty += row.qty;
    totalInstallation += row.installation;
    totalDeployment += row.deployment;
  }

  return {
    rows,
    sharedClients,
    clientOptions,
    summary: {
      totalQty,
      totalInstallation,
      totalDeployment,
      totalBalanceInstallation: totalQty - totalInstallation,
      totalBalanceDeployment: totalQty - totalDeployment,
    },
  };
}
