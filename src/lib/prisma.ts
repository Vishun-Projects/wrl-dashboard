import pg from 'pg';
import { resolveDirectDatabaseUrl } from '@/lib/read-model/db';

const connectionString = process.env.DATABASE_URL;
const cleanedConnectionString = connectionString
  ? resolveDirectDatabaseUrl(connectionString)
  : undefined;

const pool = new pg.Pool({
  connectionString: cleanedConnectionString,
  ssl: { rejectUnauthorized: false },
  max: 8,
});

pool.on('connect', (client) => {
  void client.query("SET statement_timeout = '25000'");
  void client.query("SET lock_timeout = '5000'");
});

export const prisma = {
  $queryRawUnsafe: async <T = unknown>(query: string, ...values: any[]): Promise<T> => {
    const res = await pool.query(query, values);
    return res.rows as T;
  },
  $executeRawUnsafe: async (query: string, ...values: any[]) => {
    const res = await pool.query(query, values);
    return res.rowCount;
  },
  getUserPermissions: async (userId: string): Promise<string[]> => {
    try {
      const res = await pool.query(
        `
        SELECT p.name 
        FROM public.app_permissions p
        JOIN public.app_role_permissions rp ON p.id = rp.permission_id
        JOIN public.app_users u ON rp.role_id = u.role_id
        WHERE u.id = $1
      `,
        [userId]
      );
      return res.rows.map((row) => row.name);
    } catch (err) {
      console.error('Error fetching user permissions:', err);
      return [];
    }
  },
};
