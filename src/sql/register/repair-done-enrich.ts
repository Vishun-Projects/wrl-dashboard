import { postQuery } from '@/lib/db/proxy';
import { buildRegisterRepairDoneByCallKeysSql } from '@/sql/trhcalls/query';

const ENRICH_CHUNK = 950;

function flagOn(v: unknown): boolean {
  return v === 1 || v === '1' || v === true;
}

function repairDoneFromFlags(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (flagOn(row.has_motor)) parts.push('Motor Replaced');
  if (flagOn(row.has_compressor)) parts.push('Compressor Replaced');
  if (flagOn(row.has_gas)) parts.push('Gas Charging Done');
  return parts.join('; ');
}

function callKey(ncode: unknown, officeId: unknown): string | null {
  const n = Number(ncode);
  const o = Number(officeId);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(o) || o <= 0) return null;
  return `${n}:${o}`;
}

async function fetchRepairDoneByKeys(
  keys: Array<{ ncode: number; officeId: number }>
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (let i = 0; i < keys.length; i += ENRICH_CHUNK) {
    const chunk = keys.slice(i, i + ENRICH_CHUNK);
    const rawSql = buildRegisterRepairDoneByCallKeysSql(chunk);
    if (!rawSql) continue;
    const res = await postQuery({ rawSql, timeoutMs: 45_000 });
    for (const row of (res.data || []) as Record<string, unknown>[]) {
      const key = callKey(row.id, row.office_id);
      if (!key) continue;
      byKey.set(key, repairDoneFromFlags(row));
    }
  }
  return byKey;
}

/** Attach Motor/Compressor/Gas repair_done from CRM. Soft-fails so list/export still loads. */
export async function enrichRegisterRowsRepairDone<T extends Record<string, unknown>>(
  rows: T[]
): Promise<T[]> {
  if (!rows.length) return rows;
  const keys = [
    ...new Map(
      rows
        .map((r) => ({
          ncode: Number(r.id ?? r.ncode),
          officeId: Number(r.nofficeid ?? r.officeId),
        }))
        .filter(
          (k) =>
            Number.isFinite(k.ncode) &&
            k.ncode > 0 &&
            Number.isFinite(k.officeId) &&
            k.officeId > 0
        )
        .map((k) => [`${k.ncode}:${k.officeId}`, k] as const)
    ).values(),
  ];
  if (!keys.length) return rows;

  try {
    const byKey = await fetchRepairDoneByKeys(keys);
    if (!byKey.size) return rows;

    return rows.map((row) => {
      const key = callKey(row.id ?? row.ncode, row.nofficeid ?? row.officeId);
      if (!key) return row;
      const done = byKey.get(key);
      if (done == null) return row;
      return { ...row, repair_done: done };
    });
  } catch {
    // ponytail: CRM timeout → show/export without repair chips; retry on next load
    return rows;
  }
}
