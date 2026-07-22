import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

let pool: pg.Pool | null = null;
let appPool: pg.Pool | null = null;

export function resolveDirectDatabaseUrl(raw?: string): string {
  const explicit = process.env.DIRECT_DATABASE_URL?.replace(/^["']|["']$/g, '');
  if (explicit) return explicit;

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

/** Supabase cloud requires TLS; loopback and self-hosted VPS pooler use plain TCP. */
export function resolvePgSsl(connectionString: string): false | { rejectUnauthorized: false } {
  const override = process.env.PG_SSL?.trim().toLowerCase();
  if (override === 'false' || override === '0' || override === 'disable') return false;
  if (override === 'true' || override === '1' || override === 'require') {
    return { rejectUnauthorized: false };
  }

  try {
    const url = new URL(connectionString.replace(/^postgresql:/, 'postgres:'));
    const host = url.hostname.toLowerCase();
    const port = url.port || '5432';
    const sslmode = url.searchParams.get('sslmode')?.toLowerCase();

    if (sslmode === 'disable' || sslmode === 'allow') return false;
    if (
      sslmode === 'require' ||
      sslmode === 'verify-ca' ||
      sslmode === 'verify-full' ||
      sslmode === 'prefer'
    ) {
      return { rejectUnauthorized: false };
    }

    // VPS MIS cron / sync on same host: Supavisor on loopback is plain TCP
    if (host === '127.0.0.1' || host === 'localhost') {
      return false;
    }

    // Self-hosted VPS Supavisor — plain TCP (no TLS on pooler port)
    if (host === 'api.wrl-fsm.cloud') {
      return false;
    }

    // Supabase Cloud pooler
    if (host.endsWith('.supabase.co') || host.includes('pooler.supabase.com')) {
      return { rejectUnauthorized: false };
    }
  } catch {
    /* fall through */
  }
  return false;
}

export function loadEnv(): void {
  const root = path.join(process.cwd());
  const opts = { override: false };

  function mergeMisEmailEnv(): void {
    dotenv.config({ path: path.join(root, '.env.mis-email'), ...opts });
  }

  let existing = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '') ?? '';
  if (existing.startsWith('prisma+postgres://')) {
    delete process.env.DATABASE_URL;
    existing = '';
  }
  if (existing) {
    mergeMisEmailEnv();
    return;
  }

  dotenv.config({ path: path.join(root, '.env.sync-worker'), ...opts });

  let afterSync = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '') ?? '';
  if (afterSync.startsWith('prisma+postgres://')) {
    delete process.env.DATABASE_URL;
    afterSync = '';
  }
  if (afterSync) {
    mergeMisEmailEnv();
    return;
  }

  dotenv.config({ path: path.join(root, '.env.mis-email'), ...opts });

  let afterMis = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '') ?? '';
  if (afterMis.startsWith('prisma+postgres://')) {
    delete process.env.DATABASE_URL;
    afterMis = '';
  }
  if (afterMis) {
    return;
  }

  dotenv.config({ path: path.join(root, '.env.local'), ...opts });
  dotenv.config({ path: path.join(root, '.env'), ...opts });
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
    appPool.on('error', (err) => {
      console.error('[db] app pool idle client error:', err.message);
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

function isConnectionTerminatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /connection terminated|ECONNRESET|ECONNREFUSED|Connection terminated unexpectedly/i.test(
    message
  );
}

function isConnectTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout exceeded when trying to connect|ECONNREFUSED|ETIMEDOUT/i.test(message);
}

/** Direct Postgres for sync worker / VPS cron — not the default for Next.js API routes. */
export function useDirectDatabaseForBulkReads(): boolean {
  if (process.env.USE_DIRECT_DATABASE === 'true') return true;
  return Boolean(process.env.DIRECT_DATABASE_URL?.trim());
}

function bulkReadPool(forceDirect?: boolean): { pool: pg.Pool; label: 'direct' | 'pooler' } {
  const useDirect = forceDirect ?? useDirectDatabaseForBulkReads();
  return useDirect
    ? { pool: getPool(), label: 'direct' }
    : { pool: getAppPool(), label: 'pooler' };
}

/**
 * Long-running read queries (register export, summary aggregates).
 * Uses pooler by default (reachable from dev + Vercel). Direct Postgres only when
 * USE_DIRECT_DATABASE=true or DIRECT_DATABASE_URL is set.
 */
export async function withBulkReadClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  retries = 1,
  forceDirect?: boolean
): Promise<T> {
  const { pool, label } = bulkReadPool(forceDirect);
  let client: pg.PoolClient | undefined;

  try {
    client = await pool.connect();
    const statementMs = appDatabaseBulkStatementTimeoutMs();
    const lockMs = Number(process.env.PG_LOCK_TIMEOUT_MS ?? 15_000);
    await client.query(`SET statement_timeout = '${statementMs}'`);
    await client.query(`SET lock_timeout = '${lockMs}'`);
    return await fn(client);
  } catch (err) {
    if (retries > 0 && isConnectTimeoutError(err) && (forceDirect ?? useDirectDatabaseForBulkReads())) {
      console.warn('[db] direct bulk connect failed — retrying on pooler');
      return withBulkReadClient(fn, retries - 1, false);
    }
    if (retries > 0 && isConnectionTerminatedError(err) && !(forceDirect ?? useDirectDatabaseForBulkReads())) {
      if (useDirectDatabaseForBulkReads()) {
        console.warn('[db] bulk read on pooler lost — retrying on direct Postgres');
        return withBulkReadClient(fn, retries - 1, true);
      }
      console.warn(`[db] bulk read connection lost on ${label} — retrying once`);
      return withBulkReadClient(fn, retries - 1, forceDirect);
    }
    throw err;
  } finally {
    client?.release();
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
    pool.on('error', (err) => {
      console.error('[db] direct pool idle client error:', err.message);
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
