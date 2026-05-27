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

/** Supabase pooler (port 6543) for serverless — avoids exhausting session-mode connection limits. */
export function resolvePooledDatabaseUrl(raw?: string): string {
  const connectionString = raw ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set in .env.local or .env');
  }
  let url = connectionString.replace(/^["']|["']$/g, '');
  if (url.startsWith('prisma+postgres://')) {
    throw new Error('DATABASE_URL points at Prisma local dev — set Supabase URL in .env.local');
  }
  if (url.includes(':5432/')) {
    url = url.replace(':5432/', ':6543/');
  }
  if (!url.includes('pgbouncer=true')) {
    url += url.includes('?') ? '&pgbouncer=true' : '?pgbouncer=true';
  }
  return url;
}

/** Next.js API routes use Supabase pooler (6543). Sync worker CLI uses direct via getPool() + USE_DIRECT_DATABASE. */
export function resolveAppDatabaseUrl(raw?: string): string {
  if (process.env.USE_DIRECT_DATABASE === 'true') {
    return resolveDirectDatabaseUrl(raw);
  }
  return resolvePooledDatabaseUrl(raw);
}

export function appDatabasePoolMax(): number {
  const configured = Number(process.env.PG_POOL_MAX);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 3;
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
      max: Number(process.env.SYNC_PG_POOL_MAX ?? 2),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
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
