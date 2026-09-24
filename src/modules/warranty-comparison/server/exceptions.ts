import 'server-only';

import { postQuery } from '@/lib/db/proxy';
import { withAppClient } from '@/lib/read-model/db';
import { foldAccountName } from '../account-label';
import type { ExceptionWorkDoneMode } from '../exception-cover';
import type { WarrantyExceptionAccount } from '../types';

export type { WarrantyExceptionAccount };

export type ExceptionCoverReason = 'AMC' | 'Compressor';

type CompCandidate = {
  vtrnno: string;
  ncode: string;
  nofficeid: string;
  workDoneMode: ExceptionWorkDoneMode;
  workDoneRepairNcodes: string[];
};

const OOW_W_SQL = `
  AND w.warr_end_dt IS NOT NULL
  AND CAST(c.logged_at AS DATE) > CAST(w.warr_end_dt AS DATE)
  AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'W'
`;

const EXCEPTION_SELECT = `id, system_account, amc,
       TO_CHAR(amc_valid_upto, 'YYYY-MM-DD') AS amc_valid_upto,
       compressor_warranty_months, work_done_mode, work_done_repair_ncodes, enabled, updated_at`;

function mapRow(row: Record<string, unknown>): WarrantyExceptionAccount {
  const ymd = row.amc_valid_upto == null ? null : String(row.amc_valid_upto).slice(0, 10);
  return {
    id: Number(row.id),
    systemAccount: String(row.system_account ?? ''),
    amc: Boolean(row.amc),
    amcValidUpto: ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null,
    compressorWarrantyMonths:
      row.compressor_warranty_months == null ? null : Number(row.compressor_warranty_months),
    workDoneMode: (String(row.work_done_mode ?? 'none') as ExceptionWorkDoneMode),
    workDoneRepairNcodes: Array.isArray(row.work_done_repair_ncodes)
      ? row.work_done_repair_ncodes.map(String)
      : [],
    enabled: Boolean(row.enabled),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function listExceptionAccounts(): Promise<WarrantyExceptionAccount[]> {
  return withAppClient(async (client) => {
    const res = await client.query(
      `SELECT ${EXCEPTION_SELECT}
       FROM public.warranty_exception_accounts
       ORDER BY system_account`
    );
    return res.rows.map(mapRow);
  });
}

export async function listSystemAccountOptions(): Promise<Array<{ value: string; label: string }>> {
  return withAppClient(async (client) => {
    const res = await client.query<{ val: string }>(
      `SELECT DISTINCT customer_subgroup AS val
       FROM public.warranty_master_items
       WHERE customer_subgroup IS NOT NULL AND customer_subgroup <> ''`
    );
    const map = new Map<string, string>();
    for (const r of res.rows) foldAccountName(map, r.val);
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    return [...map.values()]
      .sort((a, b) => collator.compare(a, b))
      .map((s) => ({ value: s, label: s }));
  });
}

export type ExceptionAccountWrite = {
  systemAccount: string;
  amc: boolean;
  amcValidUpto: string | null;
  compressorWarrantyMonths: number | null;
  workDoneMode: ExceptionWorkDoneMode;
  workDoneRepairNcodes: string[];
  enabled: boolean;
};

function normalizeWrite(body: ExceptionAccountWrite): ExceptionAccountWrite {
  const systemAccount = body.systemAccount.trim();
  if (!systemAccount) throw new Error('System account is required');
  const workDoneMode: ExceptionWorkDoneMode =
    body.workDoneMode === 'any' || body.workDoneMode === 'selected' ? body.workDoneMode : 'none';
  const months =
    body.compressorWarrantyMonths != null && Number.isFinite(body.compressorWarrantyMonths)
      ? Math.max(0, Math.trunc(body.compressorWarrantyMonths))
      : null;
  return {
    systemAccount,
    amc: Boolean(body.amc),
    amcValidUpto: body.amc && body.amcValidUpto ? body.amcValidUpto.slice(0, 10) : null,
    compressorWarrantyMonths: months && months > 0 ? months : null,
    workDoneMode: months && months > 0 && workDoneMode === 'none' ? 'selected' : workDoneMode,
    workDoneRepairNcodes: (body.workDoneRepairNcodes ?? []).map((n) => String(n).trim()).filter(Boolean),
    enabled: body.enabled !== false,
  };
}

export async function upsertExceptionAccount(
  body: ExceptionAccountWrite,
  id?: number
): Promise<WarrantyExceptionAccount> {
  const row = normalizeWrite(body);
  return withAppClient(async (client) => {
    const params = [
      row.systemAccount,
      row.amc,
      row.amcValidUpto,
      row.compressorWarrantyMonths,
      row.workDoneMode,
      row.workDoneRepairNcodes,
      row.enabled,
    ];
    const res = id
      ? await client.query(
          `UPDATE public.warranty_exception_accounts
           SET system_account = $1, amc = $2, amc_valid_upto = $3,
               compressor_warranty_months = $4, work_done_mode = $5,
               work_done_repair_ncodes = $6, enabled = $7, updated_at = now()
           WHERE id = $8
           RETURNING ${EXCEPTION_SELECT}`,
          [...params, id]
        )
      : await client.query(
          `INSERT INTO public.warranty_exception_accounts (
             system_account, amc, amc_valid_upto, compressor_warranty_months,
             work_done_mode, work_done_repair_ncodes, enabled
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING ${EXCEPTION_SELECT}`,
          params
        );
    if (!res.rows[0]) throw new Error(id ? 'Exception account not found' : 'Failed to save');
    return mapRow(res.rows[0]);
  }).catch((err: unknown) => {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
    if (code === '23505') throw new Error('That system account is already configured');
    throw err;
  });
}

export async function deleteExceptionAccount(id: number): Promise<void> {
  await withAppClient(async (client) => {
    await client.query(`DELETE FROM public.warranty_exception_accounts WHERE id = $1`, [id]);
  });
}

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function pairKey(ncode: string, office: string): string {
  return `${ncode}:${office}`;
}

async function crmWorkDoneKeys(
  pairs: Array<{ ncode: string; nofficeid: string }>,
  mode: 'any' | 'ncodes' | 'compressor_name',
  ncodes: string[]
): Promise<Set<string>> {
  const clean = pairs
    .map((p) => ({ ncode: digitsOnly(p.ncode), nofficeid: digitsOnly(p.nofficeid) }))
    .filter((p) => p.ncode && p.nofficeid);
  if (!clean.length) return new Set();

  const matched = new Set<string>();
  for (let i = 0; i < clean.length; i += 150) {
    const chunk = clean.slice(i, i + 150);
    const orPairs = chunk
      .map((p) => `(tf.ncalls = ${p.ncode} AND tf.nofficeid = ${p.nofficeid})`)
      .join(' OR ');
    let sql = `
      SELECT DISTINCT
        CAST(tf.ncalls AS VARCHAR(50)) AS ncode,
        CAST(tf.nofficeid AS VARCHAR(50)) AS nofficeid
      FROM trdcalls2fault tf (NOLOCK)
    `;
    if (mode === 'compressor_name') {
      sql += ` INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode`;
    }
    sql += ` WHERE (${orPairs})`;
    if (mode === 'ncodes') {
      const inList = ncodes.map(digitsOnly).filter(Boolean).join(',');
      if (!inList) continue;
      sql += ` AND tf.nrepair IN (${inList})`;
    } else if (mode === 'compressor_name') {
      sql += ` AND LTRIM(RTRIM(r.vname)) = 'Compressor Replaced'`;
    }
    const res = await postQuery({ rawSql: sql, timeoutMs: 60_000 });
    for (const row of (res.data || []) as Record<string, unknown>[]) {
      const ncode = String(row.ncode ?? '').trim();
      const office = String(row.nofficeid ?? '').trim();
      if (ncode) matched.add(pairKey(ncode, office));
    }
  }
  return matched;
}

async function compressorCoveredVtrnnos(candidates: CompCandidate[]): Promise<Set<string>> {
  const anyPairs: CompCandidate[] = [];
  const namedPairs: CompCandidate[] = [];
  const byNcodes = new Map<string, CompCandidate[]>();

  for (const c of candidates) {
    if (c.workDoneMode === 'none') continue;
    if (c.workDoneMode === 'any') {
      anyPairs.push(c);
      continue;
    }
    if (c.workDoneRepairNcodes.length === 0) {
      namedPairs.push(c);
      continue;
    }
    const key = [...c.workDoneRepairNcodes].sort().join(',');
    const list = byNcodes.get(key) ?? [];
    list.push(c);
    byNcodes.set(key, list);
  }

  const covered = new Set<string>();
  const mark = (rows: CompCandidate[], keys: Set<string>) => {
    for (const c of rows) {
      if (keys.has(pairKey(c.ncode, c.nofficeid))) covered.add(c.vtrnno);
    }
  };

  try {
    if (anyPairs.length) mark(anyPairs, await crmWorkDoneKeys(anyPairs, 'any', []));
    if (namedPairs.length) {
      mark(namedPairs, await crmWorkDoneKeys(namedPairs, 'compressor_name', []));
    }
    for (const [key, rows] of byNcodes) {
      mark(rows, await crmWorkDoneKeys(rows, 'ncodes', key.split(',')));
    }
  } catch (err) {
    console.error('[warranty-exception-crm]', err);
    return new Set();
  }
  return covered;
}

/** Lapsed + W rows covered by AMC or compressor work-done. AMC wins. */
export async function resolveCoveredVtrnnos(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  whereSql: string,
  values: unknown[]
): Promise<Map<string, ExceptionCoverReason>> {
  const reasons = new Map<string, ExceptionCoverReason>();
  const fromSql = `
    FROM public.calls_latest_hot c
    JOIN public.warranty_master_items w ON UPPER(w.serial_no) = UPPER(c.serial)
    JOIN public.warranty_exception_accounts e
      ON e.enabled
     AND UPPER(TRIM(e.system_account)) = UPPER(TRIM(w.customer_subgroup))
    ${whereSql}
    ${OOW_W_SQL}
  `;

  try {
    const amcRes = await client.query(
      `SELECT c.vtrnno ${fromSql}
       AND e.amc AND e.amc_valid_upto IS NOT NULL
       AND CAST(c.logged_at AS DATE) <= e.amc_valid_upto`,
      values
    );
    for (const r of amcRes.rows) {
      const v = String(r.vtrnno ?? '').trim();
      if (v) reasons.set(v, 'AMC');
    }

    const compRes = await client.query(
      `SELECT c.vtrnno, c.ncode, c.nofficeid, e.work_done_mode, e.work_done_repair_ncodes
       ${fromSql}
       AND e.compressor_warranty_months IS NOT NULL
       AND e.compressor_warranty_months > 0
       AND w.warr_start_dt IS NOT NULL
       AND CAST(c.logged_at AS DATE) <= (w.warr_start_dt + make_interval(months => e.compressor_warranty_months))`,
      values
    );
    const candidates: CompCandidate[] = [];
    for (const r of compRes.rows) {
      const vtrnno = String(r.vtrnno ?? '').trim();
      if (!vtrnno || reasons.has(vtrnno)) continue;
      candidates.push({
        vtrnno,
        ncode: String(r.ncode ?? ''),
        nofficeid: String(r.nofficeid ?? ''),
        workDoneMode: (String(r.work_done_mode ?? 'none') as ExceptionWorkDoneMode),
        workDoneRepairNcodes: Array.isArray(r.work_done_repair_ncodes)
          ? r.work_done_repair_ncodes.map(String)
          : [],
      });
    }
    const compressor = await compressorCoveredVtrnnos(candidates);
    for (const v of compressor) {
      if (!reasons.has(v)) reasons.set(v, 'Compressor');
    }
  } catch (err) {
    console.error('[warranty-exception-cover]', err);
  }
  return reasons;
}

export function coverageSql(tab: string, idx: number): string {
  if (tab === 'in_warr_oow') return '';
  if (tab === 'exception_ok') return `AND c.vtrnno = ANY($${idx}::text[])`;
  return `AND NOT (c.vtrnno = ANY($${idx}::text[]))`;
}
