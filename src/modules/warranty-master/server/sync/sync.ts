import { withClient } from '@/lib/read-model/db';
import { postQuery } from '@/lib/db/proxy';
import { buildWarrantyMasterSyncBatchSql } from '@/sql/warranty-master';

const DEFAULT_BATCH_SIZE = 5000;
const QUERY_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 3;

export type WarrantyMasterSyncProgress = {
  batch: number;
  rowsInBatch: number;
  totalInserted: number;
  currentNcode: number;
  elapsedMs: number;
  rateRowsPerSec: number;
};

export type WarrantyMasterSyncResult = {
  ok: boolean;
  batchesProcessed: number;
  rowsInserted: number;
  lastNcode: number;
  isComplete: boolean;
  error?: string;
};

function safeIsoDate(val: unknown): string | null {
  if (!val) return null;
  const d = new Date(String(val));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Get current highest ncode stored in Postgres for incremental / resume.
 */
export async function getHighestNcodeInPostgres(): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ max_ncode: string | null }>(`
      SELECT MAX(CAST(ncode AS FLOAT))::text AS max_ncode FROM public.warranty_master_items
    `);
    return res.rows[0]?.max_ncode ? Number(res.rows[0].max_ncode) : 0;
  });
}

/**
 * Get total machine count in local Postgres database.
 */
export async function getTotalMachinesInPostgres(): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM public.warranty_master_items
    `);
    return res.rows[0]?.count ? Number(res.rows[0].count) : 0;
  });
}

/**
 * Sync machine records from CRM to Postgres in batches.
 * If maxBatches is not provided or <= 0, runs until all CRM rows are consumed.
 */
export async function syncWarrantyMasterBatch(
  options?: {
    startNcode?: number;
    maxBatches?: number;
    batchSize?: number;
    onProgress?: (p: WarrantyMasterSyncProgress) => void;
  }
): Promise<WarrantyMasterSyncResult> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options?.maxBatches && options.maxBatches > 0 ? options.maxBatches : Infinity;
  let currentNcode = options?.startNcode ?? (await getHighestNcodeInPostgres());
  let totalInserted = 0;
  let batchesRun = 0;
  let isComplete = false;
  const startTime = Date.now();

  console.log(
    `[warranty-master-sync] Starting sync from ncode > ${currentNcode} (batchSize: ${batchSize}, maxBatches: ${Number.isFinite(maxBatches) ? maxBatches : 'unlimited'
    })`
  );

  while (batchesRun < maxBatches) {
    const sql = buildWarrantyMasterSyncBatchSql(currentNcode, batchSize);
    let res: Awaited<ReturnType<typeof postQuery>> | null = null;
    let fetchError: Error | null = null;

    // Retry loop for transient CRM timeouts
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        res = await postQuery({ rawSql: sql, timeoutMs: QUERY_TIMEOUT_MS });
        fetchError = null;
        break;
      } catch (err: unknown) {
        fetchError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[warranty-master-sync] CRM batch attempt ${attempt}/${MAX_RETRIES} failed: ${fetchError.message}`
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        }
      }
    }

    if (!res || fetchError) {
      const msg = fetchError?.message ?? 'Unknown fetch failure';
      console.error(`[warranty-master-sync] CRM batch fetch failed permanently at ncode > ${currentNcode}:`, msg);
      return {
        ok: false,
        batchesProcessed: batchesRun,
        rowsInserted: totalInserted,
        lastNcode: currentNcode,
        isComplete: false,
        error: msg,
      };
    }

    const rows = (res.data || []) as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`[warranty-master-sync] No more rows returned from CRM. Sync complete at ncode ${currentNcode}`);
      isComplete = true;
      break;
    }

    batchesRun++;
    const maxInBatch = Math.max(...rows.map((r) => Number(r.ncode ?? 0)));
    currentNcode = Number.isFinite(maxInBatch) && maxInBatch > currentNcode ? maxInBatch : currentNcode + 1;

    // Upsert batch into Postgres
    const inserted = await withClient(async (client) => {
      let count = 0;
      const chunkSize = 200;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const valueClauses: string[] = [];
        const params: unknown[] = [];
        let p = 1;

        for (const row of slice) {
          const ncode = String(row.ncode ?? '').trim();
          if (!ncode) continue;

          const serialNo = String(row.serialNo ?? row.vserialno ?? '').trim();
          if (!serialNo) continue;

          const customerName = String(row.customerName ?? '').trim();
          const customerKey = String(row.customerKey ?? '').trim();
          const groupName = String(row.groupName ?? '').trim();
          const groupKey = String(row.groupKey ?? '').trim();
          const fgModel = String(row.fgModel ?? '').trim();
          const warrantyMonths = Number(row.warrantyMonths) || 0;
          const warrStartDt = row.warrStartDt ? String(row.warrStartDt).slice(0, 10) : null;
          const warrEndDt = row.warrEndDt ? String(row.warrEndDt).slice(0, 10) : null;
          const isActive = Boolean(warrEndDt && warrEndDt >= new Date().toISOString().slice(0, 10));
          const crmEditedAt = safeIsoDate(row.crmEditedAt);
          const crmAddedAt = safeIsoDate(row.crmAddedAt);

          valueClauses.push(
            `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12})`
          );
          params.push(
            ncode,
            serialNo,
            customerName,
            customerKey,
            groupName,
            groupKey,
            fgModel,
            warrantyMonths,
            warrStartDt,
            warrEndDt,
            isActive,
            crmEditedAt,
            crmAddedAt
          );
          p += 13;
          count++;
        }

        if (valueClauses.length > 0) {
          const insertSql = `
            INSERT INTO public.warranty_master_items (
              ncode, serial_no, customer_name, customer_key, group_name, group_key,
              fg_model, warranty_months, warr_start_dt, warr_end_dt, is_active,
              crm_edited_at, crm_added_at
            ) VALUES ${valueClauses.join(', ')}
            ON CONFLICT (ncode) DO UPDATE SET
              serial_no = EXCLUDED.serial_no,
              customer_name = EXCLUDED.customer_name,
              customer_key = EXCLUDED.customer_key,
              group_name = EXCLUDED.group_name,
              group_key = EXCLUDED.group_key,
              fg_model = EXCLUDED.fg_model,
              warranty_months = EXCLUDED.warranty_months,
              warr_start_dt = EXCLUDED.warr_start_dt,
              warr_end_dt = EXCLUDED.warr_end_dt,
              is_active = (EXCLUDED.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt >= CURRENT_DATE),
              crm_edited_at = EXCLUDED.crm_edited_at,
              crm_added_at = EXCLUDED.crm_added_at,
              synced_at = NOW()
          `;
          await client.query(insertSql, params);
        }
      }
      return count;
    });

    totalInserted += inserted;
    const elapsedMs = Date.now() - startTime;
    const rate = elapsedMs > 0 ? Math.round((totalInserted / (elapsedMs / 1000))) : 0;

    const progress: WarrantyMasterSyncProgress = {
      batch: batchesRun,
      rowsInBatch: inserted,
      totalInserted,
      currentNcode,
      elapsedMs,
      rateRowsPerSec: rate,
    };

    if (options?.onProgress) {
      options.onProgress(progress);
    } else {
      console.log(
        `[warranty-master-sync] Batch ${batchesRun}: +${inserted} rows (total: ${totalInserted.toLocaleString()}, ncode: ${currentNcode}, rate: ${rate}/s)`
      );
    }

    if (rows.length < batchSize) {
      isComplete = true;
      break;
    }
  }

  return {
    ok: true,
    batchesProcessed: batchesRun,
    rowsInserted: totalInserted,
    lastNcode: currentNcode,
    isComplete,
  };
}
