#!/usr/bin/env node
/**
 * Seed Coke / Cadbury MIS client import config.
 *
 * Usage:
 *   node scripts/mis-client/seed-coke-cadbury-config.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function upsertSource(row) {
  const res = await client.query(
    `
    INSERT INTO mis_client_sources
      (code, name, file_kind, delimiter, header_row_index, call_key_column, crm_account_filter, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, true)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      file_kind = EXCLUDED.file_kind,
      delimiter = EXCLUDED.delimiter,
      header_row_index = EXCLUDED.header_row_index,
      call_key_column = EXCLUDED.call_key_column,
      crm_account_filter = EXCLUDED.crm_account_filter,
      is_active = true
    RETURNING id
    `,
    [
      row.code,
      row.name,
      row.file_kind,
      row.delimiter,
      row.header_row_index,
      row.call_key_column,
      row.crm_account_filter,
    ]
  );
  return res.rows[0].id;
}

async function seedFieldMappings(sourceId, mappings) {
  await client.query(`DELETE FROM mis_client_field_mappings WHERE source_id = $1::uuid`, [sourceId]);
  for (const m of mappings) {
    await client.query(
      `INSERT INTO mis_client_field_mappings (source_id, client_column, crm_field, transform)
       VALUES ($1::uuid, $2, $3, $4::jsonb)`,
      [sourceId, m.client_column, m.crm_field, m.transform ? JSON.stringify(m.transform) : null]
    );
  }
}

async function seedStatusMappings(sourceId, mappings) {
  await client.query(`DELETE FROM mis_client_status_mappings WHERE source_id = $1::uuid`, [sourceId]);
  for (const m of mappings) {
    await client.query(
      `INSERT INTO mis_client_status_mappings (source_id, client_status, status_bucket, status_label)
       VALUES ($1::uuid, $2, $3::status_bucket_type, $4)`,
      [sourceId, m.client_status, m.status_bucket, m.status_label]
    );
  }
}

async function seedStateMappings(sourceId, mappings) {
  await client.query(`DELETE FROM mis_client_state_mappings WHERE source_id = $1::uuid`, [sourceId]);
  for (const m of mappings) {
    await client.query(
      `INSERT INTO mis_client_state_mappings (source_id, client_state, plan_code, region_override)
       VALUES ($1::uuid, $2, $3, $4)`,
      [sourceId, m.client_state, m.plan_code ?? null, m.region_override ?? null]
    );
  }
}

try {
  // Coke MIS export: CDMS Excel (e.g. coke.xlsx) — Call No, Entity Name, header row 5
  const cokeId = await upsertSource({
    code: 'coke',
    name: 'Coke',
    file_kind: 'xlsx',
    delimiter: null,
    header_row_index: 5,
    call_key_column: 'Call No',
    crm_account_filter: 'COKE',
  });

  await seedFieldMappings(cokeId, [
    { client_column: 'Call Log Date', crm_field: 'logged_at' },
    { client_column: 'Call Status', crm_field: 'status_label' },
    { client_column: 'Entity Name', crm_field: 'state' },
    { client_column: 'Customer Name', crm_field: 'branch_name' },
    { client_column: 'Complaint Description', crm_field: 'complaint' },
    { client_column: 'Service Done Date', crm_field: 'solved_at' },
    { client_column: 'Service Engineer', crm_field: 'engineer_name' },
    { client_column: 'Call Type', crm_field: 'call_type' },
  ]);

  await seedStatusMappings(cokeId, [
    { client_status: 'Open', status_bucket: 'open_unallocated', status_label: 'Open' },
    { client_status: 'S.Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Done', status_bucket: 'tech_solved', status_label: 'Tech. Solve Call' },
    { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
  ]);

  await seedStateMappings(cokeId, [
    { client_state: 'Ameenpur Beverage', plan_code: '1162', region_override: 'SOUTH' },
    { client_state: 'Moula Ali Beverage', plan_code: '1162', region_override: 'SOUTH' },
    { client_state: 'Vijaywada Beverage', plan_code: '1181', region_override: 'SOUTH' },
    { client_state: 'Vizag Beverage', plan_code: '1181', region_override: 'SOUTH' },
    { client_state: 'Chittoor Beverage', plan_code: '1181', region_override: 'SOUTH' },
  ]);

  // Cadbury MIS export: VMS pipe CSV (e.g. VMSComplaintDetailsRpt.csv) — .TicketNumber, VDate, header row 1
  const cadburyId = await upsertSource({
    code: 'cadbury',
    name: 'Cadbury',
    file_kind: 'csv',
    delimiter: '|',
    header_row_index: 1,
    call_key_column: '.TicketNumber',
    crm_account_filter: 'CADBURY',
  });

  await seedFieldMappings(cadburyId, [
    { client_column: 'VDate', crm_field: 'logged_at' },
    { client_column: 'CallStatus', crm_field: 'status_label' },
    { client_column: 'Branchname', crm_field: 'region' },
    { client_column: 'State', crm_field: 'state' },
    { client_column: 'Town', crm_field: 'branch_name' },
    { client_column: 'Details', crm_field: 'complaint' },
    { client_column: 'ActionDate', crm_field: 'solved_at' },
    { client_column: 'ActionUserID', crm_field: 'engineer_name' },
  ]);

  await seedStatusMappings(cadburyId, [
    { client_status: 'Open', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Close', status_bucket: 'solved', status_label: 'Closed' },
    { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
  ]);

  await seedStateMappings(cadburyId, [
    { client_state: 'MAHARASHTRA', region_override: 'WEST' },
    { client_state: 'GUJARAT', region_override: 'WEST' },
    { client_state: 'DELHI', region_override: 'NORTH' },
    { client_state: 'U.P', region_override: 'NORTH' },
    { client_state: 'BIHAR', region_override: 'EAST' },
    { client_state: 'W.B', region_override: 'EAST' },
    { client_state: 'Karnataka', region_override: 'SOUTH' },
    { client_state: 'A.P', region_override: 'SOUTH' },
  ]);

  // Import filter (code): skip Service_Provider = Span Spectrum Pvt Ltd | Punjab Refrigeration

  console.log('MIS client config seeded (coke + cadbury).');
} finally {
  await client.end();
}
