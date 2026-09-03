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
};

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
        NULLIF(btrim(fo.vsapvendorcode), '') AS vendor_code
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
        statusBucket: String(row.status_bucket ?? ''),
        ncancelreason: row.ncancelreason == null ? null : Number(row.ncancelreason),
        cancelReason: row.cancel_reason,
        transferred: false,
      });
    }
  });

  const missing = unique.filter((k) => !map.has(k));
  if (missing.length === 0) return map;

  const transferred = await probeTransferredInCrm(missing);
  for (const key of transferred) {
    map.set(key, {
      vtrnno: key,
      vendorCode: null,
      statusBucket: 'transferred',
      ncancelreason: 2,
      cancelReason: null,
      transferred: true,
    });
  }

  return map;
}

async function probeTransferredInCrm(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += CRM_CHUNK) {
    const chunk = keys.slice(i, i + CRM_CHUNK);
    const inList = chunk.map((k) => `'${escapeSqlLiteral(k)}'`).join(',');
    const res = await postQuery({
      fields: 'vtrnno, vtransfercallno, ncancelreason',
      tableName: 'trhcalls',
      condition: `vtrnno IN (${inList}) AND (ISNULL(ncancelreason, 0) = 2 OR (vtransfercallno IS NOT NULL AND vtransfercallno <> ''))`,
    });
    for (const row of res.data ?? []) {
      const key = String(row.vtrnno ?? '')
        .trim()
        .toUpperCase();
      if (key) found.add(key);
    }
  }
  return found;
}
