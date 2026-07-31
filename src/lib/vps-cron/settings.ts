import { prisma } from '@/lib/db/prisma';
import {
  isVpsCronJobId,
  VPS_CRON_CATALOG,
  type VpsCronJobId,
} from '@/lib/vps-cron/catalog';

export const VPS_CRON_ORG_SETTINGS_KEY = 'vps_cron_jobs';

type Stored = { paused?: Record<string, boolean> };

let ensured = false;
let cache: { at: number; paused: Partial<Record<VpsCronJobId, boolean>> } | null = null;
const CACHE_TTL_MS = 10_000;

async function ensureAppOrgSettingsTable(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.app_org_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NULL
    )
  `);
  ensured = true;
}

function parsePaused(raw: unknown): Partial<Record<VpsCronJobId, boolean>> {
  if (!raw || typeof raw !== 'object') return {};
  const paused = (raw as Stored).paused;
  if (!paused || typeof paused !== 'object') return {};
  const out: Partial<Record<VpsCronJobId, boolean>> = {};
  for (const id of Object.keys(paused)) {
    if (isVpsCronJobId(id) && paused[id] === true) out[id] = true;
  }
  return out;
}

export function clearVpsCronSettingsCache(): void {
  cache = null;
}

export async function getVpsCronPausedMap(): Promise<Partial<Record<VpsCronJobId, boolean>>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.paused;

  try {
    await ensureAppOrgSettingsTable();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT value FROM public.app_org_settings WHERE key = $1 LIMIT 1`,
      VPS_CRON_ORG_SETTINGS_KEY
    )) as { value: unknown }[];
    const paused = parsePaused(rows[0]?.value);
    cache = { at: now, paused };
    return paused;
  } catch {
    const paused = {};
    cache = { at: now, paused };
    return paused;
  }
}

export async function isVpsCronPaused(jobId: VpsCronJobId): Promise<boolean> {
  const paused = await getVpsCronPausedMap();
  return paused[jobId] === true;
}

export async function setVpsCronPaused(
  jobId: VpsCronJobId,
  paused: boolean,
  updatedBy?: string | null
): Promise<Partial<Record<VpsCronJobId, boolean>>> {
  await ensureAppOrgSettingsTable();
  const current = await getVpsCronPausedMap();
  const next: Partial<Record<VpsCronJobId, boolean>> = { ...current };
  if (paused) next[jobId] = true;
  else delete next[jobId];

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.app_org_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    VPS_CRON_ORG_SETTINGS_KEY,
    JSON.stringify({ paused: next }),
    updatedBy ?? null
  );

  clearVpsCronSettingsCache();
  cache = { at: Date.now(), paused: next };
  return next;
}

export async function listVpsCronJobStatus(): Promise<
  Array<{
    id: VpsCronJobId;
    label: string;
    schedule: string;
    script: string;
    paused: boolean;
  }>
> {
  const paused = await getVpsCronPausedMap();
  return VPS_CRON_CATALOG.map((job) => ({
    ...job,
    paused: paused[job.id] === true,
  }));
}
