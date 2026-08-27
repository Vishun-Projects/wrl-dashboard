import { prisma } from '@/lib/db/prisma';
import {
  ATTENDANCE_ORG_SETTINGS_FALLBACKS,
  ATTENDANCE_ORG_SETTINGS_KEY,
  type AttendanceSettings,
} from '@/modules/attendance/services/org-settings-defaults';

export {
  ATTENDANCE_ORG_SETTINGS_FALLBACKS,
  ATTENDANCE_ORG_SETTINGS_KEY,
  type AttendanceSettings,
} from '@/modules/attendance/services/org-settings-defaults';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveNumber(raw: unknown, fallback: number, min = 0.001): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function parseMinutesMap(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) {
    return { ...ATTENDANCE_ORG_SETTINGS_FALLBACKS.repairDoneTypicalMinutes };
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const label = key.trim();
    if (!label) continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[label] = n;
  }
  return out;
}

/** Pure merge — empty/partial stored → code fallbacks. Ignores stale hierarchy keys. */
export function mergeAttendanceSettings(raw: unknown): AttendanceSettings {
  const base = ATTENDANCE_ORG_SETTINGS_FALLBACKS;
  if (!isRecord(raw)) {
    return {
      warnDistanceKm: base.warnDistanceKm,
      repairDoneTypicalMinutes: { ...base.repairDoneTypicalMinutes },
    };
  }
  return {
    warnDistanceKm: parsePositiveNumber(raw.warnDistanceKm, base.warnDistanceKm, 0.1),
    repairDoneTypicalMinutes:
      'repairDoneTypicalMinutes' in raw
        ? parseMinutesMap(raw.repairDoneTypicalMinutes)
        : { ...base.repairDoneTypicalMinutes },
  };
}

let ensured = false;
let cache: { at: number; settings: AttendanceSettings } | null = null;
const CACHE_TTL_MS = 15_000;

export function clearAttendanceSettingsCache(): void {
  cache = null;
}

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

type OrgSettingsRow = { value: unknown };

export async function getAttendanceSettings(options?: {
  fresh?: boolean;
}): Promise<AttendanceSettings> {
  const now = Date.now();
  if (!options?.fresh && cache && now - cache.at < CACHE_TTL_MS) return cache.settings;

  try {
    await ensureAppOrgSettingsTable();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT value FROM public.app_org_settings WHERE key = $1 LIMIT 1`,
      ATTENDANCE_ORG_SETTINGS_KEY
    )) as OrgSettingsRow[];
    const settings = mergeAttendanceSettings(rows[0]?.value);
    cache = { at: now, settings };
    return settings;
  } catch {
    const settings = mergeAttendanceSettings(null);
    cache = { at: now, settings };
    return settings;
  }
}

export async function saveAttendanceSettings(
  patch: Partial<AttendanceSettings>,
  updatedBy?: string | null
): Promise<AttendanceSettings> {
  await ensureAppOrgSettingsTable();
  const current = await getAttendanceSettings({ fresh: true });
  const next = mergeAttendanceSettings({
    ...current,
    ...patch,
    repairDoneTypicalMinutes:
      patch.repairDoneTypicalMinutes !== undefined
        ? patch.repairDoneTypicalMinutes
        : current.repairDoneTypicalMinutes,
  });

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.app_org_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    ATTENDANCE_ORG_SETTINGS_KEY,
    JSON.stringify(next),
    updatedBy ?? null
  );

  clearAttendanceSettingsCache();
  cache = { at: Date.now(), settings: next };
  return next;
}
