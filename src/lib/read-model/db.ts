import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

let pool: pg.Pool | null = null;
let appPool: pg.Pool | null = null;

export function resolveDirectDatabaseUrl(raw?: string): string {
  const connectionString = raw ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set in .env.local or .env');
  }
  let url = connectionString.replace(/^["']|["']$/g, '');
  if (url.startsWith('prisma+postgres://')) {
    throw new Error('DATABASE_URL points at Prisma local dev — set a Postgres URL in .env.local');
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
    throw new Error('DATABASE_URL points at Prisma local dev — set a Postgres URL in .env.local');
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
  return 8;
}

export function appDatabaseConnectTimeoutMs(): number {
  const configured = Number(process.env.PG_CONNECT_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 60_000;
}

export function appDatabaseStatementTimeoutMs(): number {
  const configured = Number(process.env.PG_STATEMENT_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 120_000;
}

/** Full-month register bulk preload can scan 50k+ hot rows — allow longer than paginated API queries. */
export function appDatabaseBulkStatementTimeoutMs(): number {
  const configured = Number(process.env.PG_BULK_STATEMENT_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 300_000;
}

/** Supabase cloud requires TLS; self-hosted VPS pooler (6543) typically does not. */
export function resolvePgSsl(connectionString: string): false | { rejectUnauthorized: false } {
  const override = process.env.PG_SSL?.trim().toLowerCase();
  if (override === 'false' || override === '0' || override === 'disable') return false;
  if (override === 'true' || override === '1' || override === 'require') {
    return { rejectUnauthorized: false };
  }

  try {
    const url = new URL(connectionString.replace(/^postgresql:/, 'postgres:'));
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.supabase.co') || host.includes('pooler.supabase.com')) {
      return { rejectUnauthorized: false };
    }
  } catch {
    /* fall through — self-hosted */
  }
  return false;
}

export function loadEnv(): void {
  const root = path.join(process.cwd());
  dotenv.config({ path: path.join(root, '.env.local') });
  dotenv.config({ path: path.join(root, '.env') });
}

/** Pooled Supabase URL for Next.js API routes (port 6543). */
export function getAppPool(): pg.Pool {
  if (!appPool) {
    loadEnv();
    const connectionString = resolveAppDatabaseUrl();
    appPool = new pg.Pool({
      connectionString,
      ssl: resolvePgSsl(connectionString),
      max: appDatabasePoolMax(),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: appDatabaseConnectTimeoutMs(),
      allowExitOnIdle: true,
    });
  }
  return appPool;
}

export async function withAppClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  opts?: { statementTimeoutMs?: number }
): Promise<T> {
  const client = await getAppPool().connect();
  try {
    const statementMs = opts?.statementTimeoutMs ?? appDatabaseStatementTimeoutMs();
    const lockMs = Number(process.env.PG_LOCK_TIMEOUT_MS ?? 15_000);
    await client.query(`SET statement_timeout = '${statementMs}'`);
    await client.query(`SET lock_timeout = '${lockMs}'`);
    return await fn(client);
  } finally {
    client.release();
  }
}

export function getPool(): pg.Pool {
  if (!pool) {
    loadEnv();
    const connectionString = resolveDirectDatabaseUrl();
    pool = new pg.Pool({
      connectionString,
      ssl: resolvePgSsl(connectionString),
      max: Number(process.env.SYNC_PG_POOL_MAX ?? 2),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    });
    /* Session timeouts are set per checkout in withClient / sync queries — avoid racing on connect. */
  }
  return pool;
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    const statementMs = Number(process.env.SYNC_PG_STATEMENT_TIMEOUT_MS ?? 600_000);
    const lockMs = Number(process.env.SYNC_PG_LOCK_TIMEOUT_MS ?? 10_000);
    await client.query(`SET statement_timeout = '${statementMs}'`);
    await client.query(`SET lock_timeout = '${lockMs}'`);
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
