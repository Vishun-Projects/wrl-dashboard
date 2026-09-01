import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withAppClient } from '@/lib/read-model/db';
import type { CancelledCallRow } from '@/modules/cancelled-calls/types';

function trnFromCrmRow(row: Record<string, unknown>): string {
  return String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
}

function itemCodeFromCrmRow(row: Record<string, unknown>): string | null {
  const code = String(row.itemcode ?? row.item_code ?? '').trim();
  return code || null;
}

async function persistItemCodes(byTrn: Map<string, string>): Promise<void> {
  const entries = [...byTrn.entries()];
  if (!entries.length) return;

  const vtrns = entries.map(([vtrnno]) => vtrnno);
  const codes = entries.map(([, code]) => code);

  await withAppClient(async (client) => {
    await client.query(
      `
      UPDATE calls_cancelled c
      SET item_code = data.item_code
      FROM unnest($1::text[], $2::text[]) AS data(vtrnno, item_code)
      WHERE c.vtrnno = data.vtrnno
      `,
      [vtrns, codes]
    );
    await client.query(
      `
      UPDATE calls_crm_mirror m
      SET item_code = data.item_code
      FROM unnest($1::text[], $2::text[]) AS data(vtrnno, item_code)
      WHERE m.vtrnno = data.vtrnno
      `,
      [vtrns, codes]
    );
    await client.query(
      `
      UPDATE calls_latest_hot h
      SET item_code = data.item_code
      FROM unnest($1::text[], $2::text[]) AS data(vtrnno, item_code)
      WHERE h.vtrnno = data.vtrnno
      `,
      [vtrns, codes]
    );
  });
}

/** Fill missing item codes from CRM (mstitems.vitemcode) and cache on mirror/hot. */
export async function enrichCancelledCallItemCodes(
  rows: CancelledCallRow[],
  opts?: { persist?: boolean }
): Promise<CancelledCallRow[]> {
  const missing = rows.filter((r) => !String(r.itemCode ?? '').trim());
  if (!missing.length) return rows;

  const crmRows = await fetchCrmRowsByTrns(
    missing.map((r) => r.vtrnno),
    { includeTransferred: true }
  );

  const byTrn = new Map<string, string>();
  for (const row of crmRows) {
    const trn = trnFromCrmRow(row);
    const code = itemCodeFromCrmRow(row);
    if (trn && code) byTrn.set(trn, code);
  }
  if (!byTrn.size) return rows;

  if (opts?.persist !== false) {
    await persistItemCodes(byTrn);
  }

  return rows.map((r) => {
    if (String(r.itemCode ?? '').trim()) return r;
    const code = byTrn.get(r.vtrnno) ?? null;
    return code ? { ...r, itemCode: code } : r;
  });
}
