import type pg from 'pg';
import { toBigInt } from '@/lib/read-model/transform';
import {
  fetchDimCallTypes,
  fetchDimEngineers,
  fetchDimOffices,
  looksLikeBranchOffice,
} from '@/lib/read-model/crm-fetch';
import { refreshDimensions } from '@/lib/read-model/dims';
import type { AuditOptions, DimTableAuditSummary } from '@/lib/read-model/audit/types';

type DimEntity = 'dim_offices' | 'dim_engineers' | 'dim_call_types';

function emptyDimSummary(): DimTableAuditSummary {
  return {
    postgres_count: 0,
    crm_count: 0,
    missing_in_postgres: 0,
    extra_in_postgres: 0,
    column_mismatch_rows: 0,
    column_mismatches: 0,
  };
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

async function loadPostgresOffices(client: pg.PoolClient) {
  const res = await client.query(
    `SELECT ncode, vcompanyname, nunder, nzone, is_branch FROM dim_offices ORDER BY ncode`
  );
  return res.rows;
}

async function loadPostgresEngineers(client: pg.PoolClient) {
  const res = await client.query(
    `SELECT ncode, vname, nofficeid FROM dim_engineers ORDER BY ncode`
  );
  return res.rows;
}

async function loadPostgresCallTypes(client: pg.PoolClient) {
  const res = await client.query(
    `SELECT ncode, display_value FROM dim_call_types ORDER BY ncode`
  );
  return res.rows;
}

function buildCrmOfficeMap(rows: Record<string, string>[]) {
  const map = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const ncode = toBigInt(row.ncode);
    if (!ncode || map.has(ncode)) continue;
    map.set(ncode, row);
  }
  return map;
}

function buildCrmEngineerMap(rows: Record<string, string>[]) {
  const map = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const ncode = toBigInt(row.ncode);
    if (!ncode || map.has(ncode)) continue;
    map.set(ncode, row);
  }
  return map;
}

function buildCrmCallTypeMap(rows: Record<string, string>[]) {
  const map = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const ncode = toBigInt(row.ncode);
    if (!ncode || map.has(ncode)) continue;
    map.set(ncode, row);
  }
  return map;
}

function compareDimTable(
  entity: DimEntity,
  pgMap: Map<number, Record<string, unknown>>,
  crmMap: Map<number, Record<string, string>>,
  compareRow: (pgRow: Record<string, unknown>, crmRow: Record<string, string>) => string[],
  opts: Pick<AuditOptions, 'onMismatch'>
): DimTableAuditSummary {
  const summary = emptyDimSummary();
  summary.postgres_count = pgMap.size;
  summary.crm_count = crmMap.size;

  for (const [ncode, crmRow] of crmMap) {
    const pgRow = pgMap.get(ncode);
    if (!pgRow) {
      summary.missing_in_postgres++;
      opts.onMismatch?.({
        phase: 'dims',
        entity,
        kind: 'missing_in_hot',
        key: String(ncode),
        details: { ncode },
      });
      continue;
    }
    const badCols = compareRow(pgRow, crmRow);
    if (badCols.length === 0) continue;
    summary.column_mismatch_rows++;
    summary.column_mismatches += badCols.length;
    opts.onMismatch?.({
      phase: 'dims',
      entity,
      kind: 'column_mismatch',
      key: String(ncode),
      columns: badCols.map((column) => ({
        column,
        hot_value: pgRow[column],
        expected_value: crmRow[column === 'display_value' ? 'vdisplayvalue' : column],
      })),
    });
  }

  for (const ncode of pgMap.keys()) {
    if (!crmMap.has(ncode)) {
      summary.extra_in_postgres++;
      opts.onMismatch?.({
        phase: 'dims',
        entity,
        kind: 'extra_in_hot',
        key: String(ncode),
        details: { ncode },
      });
    }
  }

  return summary;
}

export async function auditDimensions(
  client: pg.PoolClient,
  opts: Pick<AuditOptions, 'onMismatch' | 'onProgress'>
): Promise<{
  offices: DimTableAuditSummary;
  engineers: DimTableAuditSummary;
  call_types: DimTableAuditSummary;
}> {
  opts.onProgress?.('Dims audit: fetching CRM masters');
  const [crmOffices, crmEngineers, crmCallTypes] = await Promise.all([
    fetchDimOffices(),
    fetchDimEngineers(),
    fetchDimCallTypes(),
  ]);

  const [pgOffices, pgEngineers, pgCallTypes] = [
    await loadPostgresOffices(client),
    await loadPostgresEngineers(client),
    await loadPostgresCallTypes(client),
  ];

  const pgOfficeMap = new Map(
    pgOffices.map((r) => [Number(r.ncode), r as Record<string, unknown>])
  );
  const pgEngineerMap = new Map(
    pgEngineers.map((r) => [Number(r.ncode), r as Record<string, unknown>])
  );
  const pgCallTypeMap = new Map(
    pgCallTypes.map((r) => [Number(r.ncode), r as Record<string, unknown>])
  );

  const offices = compareDimTable(
    'dim_offices',
    pgOfficeMap,
    buildCrmOfficeMap(crmOffices),
    (pgRow, crmRow) => {
      const bad: string[] = [];
      if (normalizeText(pgRow.vcompanyname) !== normalizeText(crmRow.vcompanyname)) {
        bad.push('vcompanyname');
      }
      if (toBigInt(pgRow.nunder) !== toBigInt(crmRow.nunder)) bad.push('nunder');
      if (toBigInt(pgRow.nzone) !== toBigInt(crmRow.nzone)) bad.push('nzone');
      const expectedBranch = looksLikeBranchOffice(String(crmRow.vcompanyname ?? ''));
      if (Boolean(pgRow.is_branch) !== expectedBranch) bad.push('is_branch');
      return bad;
    },
    opts
  );

  const engineers = compareDimTable(
    'dim_engineers',
    pgEngineerMap,
    buildCrmEngineerMap(crmEngineers),
    (pgRow, crmRow) => {
      const bad: string[] = [];
      if (normalizeText(pgRow.vname) !== normalizeText(crmRow.vname)) bad.push('vname');
      if (toBigInt(pgRow.nofficeid) !== toBigInt(crmRow.nofficeid)) bad.push('nofficeid');
      return bad;
    },
    opts
  );

  const call_types = compareDimTable(
    'dim_call_types',
    pgCallTypeMap,
    buildCrmCallTypeMap(crmCallTypes),
    (pgRow, crmRow) => {
      const bad: string[] = [];
      if (normalizeText(pgRow.display_value) !== normalizeText(crmRow.vdisplayvalue)) {
        bad.push('display_value');
      }
      return bad;
    },
    opts
  );

  opts.onProgress?.(
    `Dims audit done — offices ${offices.column_mismatch_rows} mismatches, engineers ${engineers.column_mismatch_rows}, call types ${call_types.column_mismatch_rows}`
  );

  return { offices, engineers, call_types };
}

export async function applyDimsAuditFixes(client: pg.PoolClient): Promise<boolean> {
  await refreshDimensions(client);
  return true;
}
