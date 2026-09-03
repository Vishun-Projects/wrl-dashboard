import { postQuery } from '@/lib/db/proxy';
import { escapeSqlLiteral } from '@/lib/crm/sql-builder';
import { withAppClient } from '@/lib/read-model/db';
import type { SpareLoanCallLookup } from '@/modules/spare-loan-check/types';

const CRM_CHUNK = 80;

type MirrorRow = {
  vtrnno: string;
  status_bucket: string;
  ncancelreason: number | null;
  cancel_reason: string | null;
  vendor_code: string | null;
  vendor_name: string | null;
  logged_at: Date | null;
  last_edited_at: Date | null;
};

function toIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function lookupCallsByVtrnno(
  keys: string[]
): Promise<Map<string, SpareLoanCallLookup>> {
  const unique = [...new Set(keys.map((k) => k.trim().toUpperCase()).filter(Boolean))];
  const map = new Map<string, SpareLoanCallLookup>();
  if (unique.length === 0) return map;

  await withAppClient(async (client) => {
    const { rows } = await client.query<MirrorRow>(
      `
      SELECT
        upper(btrim(m.vtrnno)) AS vtrnno,
        m.status_bucket::text AS status_bucket,
        m.ncancelreason,
        NULLIF(btrim(m.cancel_reason), '') AS cancel_reason,
        NULLIF(btrim(fo.vsapvendorcode), '') AS vendor_code,
        NULLIF(btrim(fo.vcompanyname), '') AS vendor_name,
        m.logged_at,
        COALESCE(m.cancelled_at, m.edited_at, m.source_editedon) AS last_edited_at
      FROM calls_crm_mirror m
      LEFT JOIN dim_offices fo ON fo.ncode = (
        CASE
          WHEN btrim(COALESCE(m.franchisee_code, '')) ~ '^[0-9]+$'
          THEN btrim(m.franchisee_code)::bigint
          ELSE NULL
        END
      )
      WHERE upper(btrim(m.vtrnno)) = ANY($1::text[])
      `,
      [unique]
    );

    for (const row of rows) {
      const key = String(row.vtrnno ?? '').trim().toUpperCase();
      if (!key) continue;
      map.set(key, {
        vtrnno: key,
        vendorCode: row.vendor_code,
        vendorName: row.vendor_name,
        statusBucket: String(row.status_bucket ?? ''),
        ncancelreason: row.ncancelreason == null ? null : Number(row.ncancelreason),
        cancelReason: row.cancel_reason,
        transferred: false,
        loggedAt: toIso(row.logged_at),
        lastEditedAt: toIso(row.last_edited_at),
      });
    }
  });

  const missing = unique.filter((k) => !map.has(k));
  if (missing.length === 0) return map;

  // Best-effort only — CRM outages must not fail the whole import (mirror hits still save).
  try {
    const transferred = await probeTransferredInCrm(missing);
    for (const [key, dates] of transferred) {
      map.set(key, {
        vtrnno: key,
        vendorCode: null,
        vendorName: null,
        statusBucket: 'transferred',
        ncancelreason: 2,
        cancelReason: null,
        transferred: true,
        loggedAt: dates.loggedAt,
        lastEditedAt: dates.lastEditedAt,
      });
    }
  } catch (err) {
    console.warn(
      '[spare-loan-check] CRM transfer probe skipped:',
      err instanceof Error ? err.message : err
    );
  }

  return map;
}

async function probeTransferredInCrm(
  keys: string[]
): Promise<Map<string, { loggedAt: string | null; lastEditedAt: string | null }>> {
  const found = new Map<string, { loggedAt: string | null; lastEditedAt: string | null }>();
  // Cap CRM traffic: large ZSS02 files have thousands of SOs absent from mirror.
  const MAX_KEYS = 400;
  const toProbe = keys.length > MAX_KEYS ? keys.slice(0, MAX_KEYS) : keys;
  if (keys.length > MAX_KEYS) {
    console.warn(
      `[spare-loan-check] transfer probe capped at ${MAX_KEYS}/${keys.length} missing SOs`
    );
  }

  for (let i = 0; i < toProbe.length; i += CRM_CHUNK) {
    const chunk = toProbe.slice(i, i + CRM_CHUNK);
    const inList = chunk.map((k) => `'${escapeSqlLiteral(k)}'`).join(',');
    try {
      const res = await postQuery({
        fields:
          'vtrnno, vtransfercallno, ncancelreason, CONVERT(varchar(30), dtrndate, 126) as dtrndate, CONVERT(varchar(30), editedon, 126) as editedon',
        tableName: 'trhcalls',
        condition: `vtrnno IN (${inList}) AND (ISNULL(ncancelreason, 0) = 2 OR (vtransfercallno IS NOT NULL AND vtransfercallno <> ''))`,
      });
      for (const row of res.data ?? []) {
        const key = String(row.vtrnno ?? '')
          .trim()
          .toUpperCase();
        if (!key) continue;
        found.set(key, {
          loggedAt: toIso(row.dtrndate),
          lastEditedAt: toIso(row.editedon),
        });
      }
    } catch (err) {
      console.warn(
        '[spare-loan-check] CRM transfer chunk failed — stopping further CRM probes:',
        err instanceof Error ? err.message : err
      );
      break;
    }
  }
  return found;
}
