/**
 * Must be the first import in read-model CLI entrypoints so DATABASE_URL and
 * other vars are loaded before any module that touches Supabase or Postgres pools.
 */
import { loadEnv } from '@/lib/read-model/db';

const CLOUD_HOST_PATTERNS = ['.supabase.co', 'pooler.supabase.com', 'aws-0-', 'aws-1-'];

function parseDatabaseHost(connectionString: string | undefined): string | null {
  if (!connectionString?.trim()) return null;
  try {
    const url = new URL(connectionString.replace(/^postgresql:/, 'postgres:').replace(/^["']|["']$/g, ''));
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Ensure sync worker writes to self-hosted VPS Postgres, not Supabase Cloud. */
export function assertSyncWritesToVps(): void {
  const host = parseDatabaseHost(process.env.DATABASE_URL);
  if (!host) {
    throw new Error(
      'DATABASE_URL is missing or invalid. Set it to your VPS Postgres (api.wrl-fsm.cloud) in .env.local — see scripts/vps-hosting/VERCEL_ENV.md'
    );
  }

  const isCloud = CLOUD_HOST_PATTERNS.some((pattern) => host.includes(pattern));
  if (isCloud) {
    throw new Error(
      `DATABASE_URL host "${host}" is Supabase Cloud. Sync worker must write to your VPS at api.wrl-fsm.cloud (port 6543 pooler or :5432 direct), not supabase.co. Update .env.local and retry.`
    );
  }

  const directHost = parseDatabaseHost(
    process.env.DATABASE_URL?.replace(':6543/', ':5432/').replace(/[?&]pgbouncer=true/g, '')
  );
  console.log(
    `[sync-worker] Write target: ${host} → direct bulk sync uses ${directHost ?? host}:5432 | Read source: Western CRM (westerncrm.com)`
  );
}


loadEnv();
// CLI sync bypasses pooler session limits — bulk upserts need direct Postgres.
process.env.USE_DIRECT_DATABASE = 'true';
assertSyncWritesToVps();
