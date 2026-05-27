import pg from 'pg';
import { resolveAppDatabaseUrl, appDatabasePoolMax } from '@/lib/read-model/db';
import { getUserPermissions as getUserPermissionsViaSupabase } from './auth';

declare global {
  // eslint-disable-next-line no-var
  var __wrlPrismaPool: pg.Pool | undefined;
}

function getPool(): pg.Pool {
  if (!global.__wrlPrismaPool) {
    const connectionString = process.env.DATABASE_URL;
    const cleanedConnectionString = connectionString
      ? resolveAppDatabaseUrl(connectionString)
      : undefined;

    global.__wrlPrismaPool = new pg.Pool({
      connectionString: cleanedConnectionString,
      ssl: { rejectUnauthorized: false },
      max: appDatabasePoolMax(),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    });

    global.__wrlPrismaPool.on('connect', (client) => {
      void client.query("SET statement_timeout = '25000'");
      void client.query("SET lock_timeout = '5000'");
    });
  }
  return global.__wrlPrismaPool;
}

export const prisma = {
  $queryRawUnsafe: async <T = unknown>(query: string, ...values: any[]): Promise<T> => {
    const res = await getPool().query(query, values);
    return res.rows as T;
  },
  $executeRawUnsafe: async (query: string, ...values: any[]) => {
    const res = await getPool().query(query, values);
    return res.rowCount;
  },
  getUserPermissions: getUserPermissionsViaSupabase,
};
