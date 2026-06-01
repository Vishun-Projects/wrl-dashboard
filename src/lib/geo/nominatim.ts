import 'server-only';

import { prisma } from '@/lib/prisma';

let tableEnsured = false;

async function ensureGeocodeCacheTable(): Promise<void> {
  if (tableEnsured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS address_geocode_cache (
      address_hash   varchar(64) PRIMARY KEY,
      query_text     text NOT NULL,
      lat            double precision,
      lng            double precision,
      success        boolean NOT NULL DEFAULT false,
      fetched_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  tableEnsured = true;
}

export async function clearAddressGeocodeCache(): Promise<number> {
  await ensureGeocodeCacheTable();
  const rows = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `WITH deleted AS (
       DELETE FROM address_geocode_cache RETURNING 1
     ) SELECT COUNT(*)::text AS count FROM deleted`
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getAddressGeocodeCacheCount(): Promise<number> {
  await ensureGeocodeCacheTable();
  const rows = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM address_geocode_cache`
  );
  return Number(rows[0]?.count ?? 0);
}
