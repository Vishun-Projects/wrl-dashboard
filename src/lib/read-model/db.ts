import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

let pool: pg.Pool | null = null;

export function resolveDirectDatabaseUrl(raw?: string): string {
  const connectionString = raw ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set in .env.local or .env');
  }
  let url = connectionString.replace(/^["']|["']$/g, '');
  if (url.startsWith('prisma+postgres://')) {
    throw new Error('DATABASE_URL points at Prisma local dev — set Supabase URL in .env.local');
  }
  url = url.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');
  url = url.replace(':6543/', ':5432/');
  return url;
}

export function loadEnv(): void {
  const root = path.join(process.cwd());
  dotenv.config({ path: path.join(root, '.env.local') });
  dotenv.config({ path: path.join(root, '.env') });
}

export function getPool(): pg.Pool {
  if (!pool) {
    loadEnv();
    pool = new pg.Pool({
      connectionString: resolveDirectDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 6,
    });
    pool.on('connect', (client) => {
      void client.query(`SET statement_timeout = '${Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 25000)}'`);
      void client.query(`SET lock_timeout = '${Number(process.env.PG_LOCK_TIMEOUT_MS ?? 5000)}'`);
    });
  }
  return pool;
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
