import type pg from 'pg';
import {
  appDatabaseBulkStatementTimeoutMs,
  appDatabaseStatementTimeoutMs,
  withAppClient,
} from '@/lib/read-model/db';

export const prisma = {
  $queryRawUnsafe: async <T = unknown>(query: string, ...values: unknown[]): Promise<T> => {
    return withAppClient(async (client) => {
      const res = await client.query(query, values);
      return res.rows as T;
    });
  },
  /** Register/distribution bulk preload — longer statement timeout than paginated reads. */
  $queryRawUnsafeBulk: async <T = unknown>(query: string, ...values: unknown[]): Promise<T> => {
    return withAppClient(
      async (client) => {
        const res = await client.query(query, values);
        return res.rows as T;
      },
      { statementTimeoutMs: appDatabaseBulkStatementTimeoutMs() }
    );
  },
  $executeRawUnsafe: async (query: string, ...values: unknown[]) => {
    return withAppClient(async (client) => {
      const res = await client.query(query, values);
      return res.rowCount;
    });
  },
  getUserPermissions: async (userId: string): Promise<string[]> => {
    const { getUserPermissions } = await import('./auth');
    return getUserPermissions(userId);
  },
};
