
import {
  withAppClient,
  withBulkReadClient,
} from '@/lib/read-model/db';

export const prisma = {
  $queryRawUnsafe: async <T = unknown>(query: string, ...values: unknown[]): Promise<T> => {
    return withAppClient(async (client) => {
      const res = await client.query(query, values);
      return res.rows as T;
    });
  },
  /** Bulk reads — direct Postgres to avoid pooler ~60s disconnect on long exports. */
  $queryRawUnsafeBulk: async <T = unknown>(query: string, ...values: unknown[]): Promise<T> => {
    return withBulkReadClient(async (client) => {
      const res = await client.query(query, values);
      return res.rows as T;
    });
  },
  $executeRawUnsafe: async (query: string, ...values: unknown[]) => {
    return withAppClient(async (client) => {
      const res = await client.query(query, values);
      return res.rowCount;
    });
  },
  getUserPermissions: async (userId: string): Promise<string[]> => {
    const { getUserPermissions } = await import('../auth/session');
    return getUserPermissions(userId);
  },
};
