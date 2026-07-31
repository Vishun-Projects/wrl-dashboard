import type pg from 'pg';
import {
  fetchDimCallTypes,
  fetchDimEngineers,
  fetchDimOffices,
  looksLikeBranchOffice,
} from '@/lib/read-model/crm-fetch';

import { toBigInt } from '@/lib/read-model/transform';

async function batchInsert(
  client: pg.PoolClient,
  prefix: string,
  rows: unknown[][],
  batchSize = 200
): Promise<void> {
  if (rows.length === 0) return;
  const colsPerRow = rows[0].length;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((row, rowIndex) => {
      const offset = rowIndex * colsPerRow;
      placeholders.push(
        `(${row.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...row);
    });

    await client.query(`${prefix} VALUES ${placeholders.join(', ')}`, values);
  }
}

export async function refreshDimensions(client: pg.PoolClient): Promise<{
  offices: number;
  engineers: number;
  callTypes: number;
}> {
  const [offices, engineers, callTypes] = await Promise.all([
    fetchDimOffices(),
    fetchDimEngineers(),
    fetchDimCallTypes(),
  ]);

  const officeRows: unknown[][] = [];
  const officeByCode = new Map<number, (typeof offices)[0]>();
  for (const row of offices) {
    const ncode = toBigInt(row.ncode);
    if (!ncode || officeByCode.has(ncode)) continue;
    officeByCode.set(ncode, row);
  }
  for (const row of officeByCode.values()) {
    const ncode = toBigInt(row.ncode);
    if (!ncode) continue;
    const name = String(row.vcompanyname ?? '').trim();
    officeRows.push([
      ncode,
      name || null,
      toBigInt(row.nunder),
      toBigInt(row.nzone),
      looksLikeBranchOffice(name),
    ]);
  }

  const engineerRows: unknown[][] = [];
  const engineerByCode = new Map<number, (typeof engineers)[0]>();
  for (const row of engineers) {
    const ncode = toBigInt(row.ncode);
    if (!ncode || engineerByCode.has(ncode)) continue;
    engineerByCode.set(ncode, row);
  }
  for (const row of engineerByCode.values()) {
    const ncode = toBigInt(row.ncode);
    if (!ncode) continue;
    engineerRows.push([ncode, String(row.vname ?? '').trim(), toBigInt(row.nofficeid)]);
  }

  const callTypeRows: unknown[][] = [];
  const callTypeByCode = new Map<number, (typeof callTypes)[0]>();
  for (const row of callTypes) {
    const ncode = toBigInt(row.ncode);
    if (!ncode || callTypeByCode.has(ncode)) continue;
    callTypeByCode.set(ncode, row);
  }
  for (const row of callTypeByCode.values()) {
    const ncode = toBigInt(row.ncode);
    if (!ncode) continue;
    callTypeRows.push([ncode, String(row.vdisplayvalue ?? '').trim()]);
  }

  await client.query(`TRUNCATE dim_offices, dim_engineers, dim_call_types`);

  await batchInsert(
    client,
    `INSERT INTO dim_offices (ncode, vcompanyname, nunder, nzone, is_branch, region, synced_at)`,
    officeRows.map((row) => [...row, 'OTHER', new Date()])
  );
  await batchInsert(
    client,
    `INSERT INTO dim_engineers (ncode, vname, nofficeid, synced_at)`,
    engineerRows.map((row) => [...row, new Date()])
  );
  await batchInsert(
    client,
    `INSERT INTO dim_call_types (ncode, display_value, synced_at)`,
    callTypeRows.map((row) => [...row, new Date()])
  );

  await markDimensionSyncStateOk(client);

  return {
    offices: officeRows.length,
    engineers: engineerRows.length,
    callTypes: callTypeRows.length,
  };
}

export async function markDimensionSyncStateOk(client: pg.PoolClient): Promise<void> {
  const entities = ['dim_offices', 'dim_engineers', 'dim_call_types'];
  for (const entity of entities) {
    await client.query(
      `UPDATE sync_state
       SET status = 'ok', is_running = false, last_run_at = now()
       WHERE entity = $1`,
      [entity]
    );
  }
}
