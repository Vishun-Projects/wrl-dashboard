#!/usr/bin/env node
/**
 * Seed mis_plant_region_mappings from BD MIS Format.xlsx Code sheet.
 * Usage: node scripts/mis-client/seed-plant-region.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

/** Format.xlsx Code sheet — Plant → BD MIS region zone */
const MAPPINGS = [
  { office_id: 1126, region_zone: 'WEST ZONE' },
  { office_id: 1127, region_zone: 'EAST ZONE' },
  { office_id: 1128, region_zone: 'SOUTH ZONE' },
  { office_id: 1134, region_zone: 'WEST ZONE' },
  { office_id: 1140, region_zone: 'WEST ZONE' },
  { office_id: 1150, region_zone: 'EAST ZONE' },
  { office_id: 1152, region_zone: 'SOUTH ZONE' },
  { office_id: 1154, region_zone: 'EAST ZONE' },
  { office_id: 1157, region_zone: 'SOUTH ZONE' },
  { office_id: 1158, region_zone: 'SOUTH ZONE' },
  { office_id: 1159, region_zone: 'SOUTH ZONE' },
  { office_id: 1161, region_zone: 'SOUTH ZONE' },
  { office_id: 1162, region_zone: 'SOUTH ZONE' },
  { office_id: 1163, region_zone: 'NORTH ZONE' },
  { office_id: 1164, region_zone: 'NORTH ZONE' },
  { office_id: 1166, region_zone: 'NORTH ZONE' },
  { office_id: 1167, region_zone: 'NORTH ZONE' },
  { office_id: 1170, region_zone: 'WEST ZONE' },
  { office_id: 1171, region_zone: 'WEST ZONE' },
  { office_id: 1173, region_zone: 'NORTH ZONE' },
  { office_id: 1175, region_zone: 'WEST ZONE' },
  { office_id: 1176, region_zone: 'EAST ZONE' },
  { office_id: 1181, region_zone: 'SOUTH ZONE' },
  { office_id: 1182, region_zone: 'EAST ZONE' },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mis_plant_region_mappings (
      office_id   bigint PRIMARY KEY,
      region_zone text NOT NULL CHECK (region_zone IN ('NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE'))
    )
  `);

  for (const row of MAPPINGS) {
    await client.query(
      `INSERT INTO mis_plant_region_mappings (office_id, region_zone)
       VALUES ($1, $2)
       ON CONFLICT (office_id) DO UPDATE SET region_zone = EXCLUDED.region_zone`,
      [row.office_id, row.region_zone]
    );
  }

  console.log(`Seeded ${MAPPINGS.length} plant→region mappings.`);
} finally {
  await client.end();
}
