import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

// Clean connection string for pg driver (remove pgbouncer=true if present)
const cleanedConnectionString = connectionString?.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');

const pool = new pg.Pool({ 
  connectionString: cleanedConnectionString,
  ssl: { rejectUnauthorized: false }
});

// Mocking Prisma's raw SQL interface directly with pg pool
export const prisma = {
  $queryRawUnsafe: async (query: string, ...values: any[]) => {
    try {
      const res = await pool.query(query, values);
      return res.rows;
    } catch (err) {

      throw err;
    }
  },
  $executeRawUnsafe: async (query: string, ...values: any[]) => {
    try {
      const res = await pool.query(query, values);
      return res.rowCount;
    } catch (err) {

      throw err;
    }
  },
  getUserPermissions: async (userId: string): Promise<string[]> => {
    try {
      const res = await pool.query(`
        SELECT p.name 
        FROM public.app_permissions p
        JOIN public.app_role_permissions rp ON p.id = rp.permission_id
        JOIN public.app_users u ON rp.role_id = u.role_id
        WHERE u.id = $1
      `, [userId]);
      return res.rows.map(row => row.name);
    } catch (err) {
      console.error('Error fetching user permissions:', err);
      return [];
    }
  }
};
