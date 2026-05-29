import pg from 'pg';
import {
  resolveAppDatabaseUrl,
  appDatabasePoolMax,
  appDatabaseConnectTimeoutMs,
  appDatabaseStatementTimeoutMs,
} from '@/lib/read-model/db';

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
      connectionTimeoutMillis: appDatabaseConnectTimeoutMs(),
      allowExitOnIdle: true,
    });

    global.__wrlPrismaPool.on('connect', (client) => {
      const statementMs = appDatabaseStatementTimeoutMs();
      const lockMs = Number(process.env.PG_LOCK_TIMEOUT_MS ?? 15_000);
      void (async () => {
        await client.query(`SET statement_timeout = '${statementMs}'`);
        await client.query(`SET lock_timeout = '${lockMs}'`);
      })();
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
  getUserPermissions: async (userId: string): Promise<string[]> => {
    const { getUserPermissions } = await import('./auth');
    return getUserPermissions(userId);
  },
};
