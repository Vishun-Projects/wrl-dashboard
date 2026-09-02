import { randomUUID } from 'crypto';
import { withAppClient } from '@/lib/read-model/db';
import { fetchCrmAthenaFailedCalls, fetchCrmAthenaFailedCallsIncremental } from './crm-fetch';
import { computeAthenaRawFingerprint, normalizeAthenaFailedRow } from './normalize';
import { executeAthenaReconciliation, type ReconciliationRunStats } from './reconcile';

const ENTITY = 'athena_failed_calls';
const BATCH_SIZE = 500;

export type AthenaSyncOptions = {
  dateFrom?: string | null;
  dateTo?: string | null;
  reprocessAll?: boolean;
  fullBackfill?: boolean;
};

export type AthenaSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  batchId: string;
  runId: number;
  crmRowsFetched: number;
  newRawIngested: number;
  reconciliationStats: ReconciliationRunStats;
  errorMessage?: string;
};

export async function runAthenaFailedCallsSync(
  opts?: AthenaSyncOptions
): Promise<AthenaSyncResult> {
  const batchId = randomUUID();
  const startedAt = new Date();
  let runId = 0;

  console.log(`[athena-sync] Starting Athena failed calls sync (batch: ${batchId})...`);

  // 1. Initialize audit run record
  await withAppClient(async (client) => {
    const runRes = await client.query<{ run_id: string }>(
      `INSERT INTO athena_reconciliation_runs (run_mode, status, started_at)
       VALUES ($1, 'running', $2)
       RETURNING run_id`,
      [opts?.fullBackfill ? 'backfill' : 'incremental', startedAt]
    );
    runId = parseInt(runRes.rows[0].run_id, 10);
  });

  try {
    // 2. Determine fetch parameters & watermarks
    let watermarkAddedon: Date | null = null;

    if (!opts?.fullBackfill && !opts?.dateFrom) {
      const syncState = await withAppClient(async (client) => {
        const res = await client.query<{ last_addedon: Date | null }>(
          `SELECT last_addedon FROM sync_state WHERE entity = $1`,
          [ENTITY]
        );
        return res.rows[0];
      });
      if (syncState?.last_addedon && syncState.last_addedon.getTime() > 0) {
        watermarkAddedon = syncState.last_addedon;
      }
    }

    // 3. Fetch from CRM — chunk monthly when no watermark to avoid CRM OOM
    let crmRows: Awaited<ReturnType<typeof fetchCrmAthenaFailedCalls>>;

    if (watermarkAddedon || opts?.dateFrom || opts?.fullBackfill) {
      if (watermarkAddedon && !opts?.dateFrom && !opts?.fullBackfill) {
        crmRows = await fetchCrmAthenaFailedCallsIncremental(watermarkAddedon);
      } else {
        crmRows = await fetchCrmAthenaFailedCalls({
          dateFrom: opts?.dateFrom,
          dateTo: opts?.dateTo,
          watermarkAddedon,
          fullBackfill: opts?.fullBackfill,
        });
      }
    } else {
      // No watermark: chunk YTD by month to avoid CRM query OOM
      // ponytail: 1-month chunk is conservative; raise ATHENA_CHUNK_MONTHS if CRM can handle more
      const CHUNK_MONTHS = Number(process.env.ATHENA_CHUNK_MONTHS ?? 1) || 1;
      const startYear = Number(process.env.ATHENA_SYNC_START_YEAR ?? new Date().getFullYear());
      const startDate = new Date(`${startYear}-01-01`);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      const chunks: Array<{ from: string; to: string }> = [];
      const cursor = new Date(startDate);
      while (cursor <= today) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setMonth(chunkEnd.getMonth() + CHUNK_MONTHS);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        chunks.push({
          from: cursor.toISOString().slice(0, 10),
          to: (chunkEnd > today ? today : chunkEnd).toISOString().slice(0, 10),
        });
        cursor.setMonth(cursor.getMonth() + CHUNK_MONTHS);
      }

      console.log(`[athena-sync] No watermark — chunking fetch into ${chunks.length} monthly windows`);
      crmRows = [];
      for (const chunk of chunks) {
        console.log(`[athena-sync] Fetching chunk ${chunk.from} → ${chunk.to}`);
        const chunkRows = await fetchCrmAthenaFailedCalls({ dateFrom: chunk.from, dateTo: chunk.to });
        crmRows = crmRows.concat(chunkRows);
      }
    }

    console.log(`[athena-sync] Fetched ${crmRows.length} records from CRM rpt_failedathenacalls`);

    let newRawIngested = 0;
    let maxAddedon: Date | null = watermarkAddedon;

    // 4. Batch ingest raw and normalized rows
    if (crmRows.length > 0) {
      await withAppClient(async (client) => {
        for (let i = 0; i < crmRows.length; i += BATCH_SIZE) {
          const chunk = crmRows.slice(i, i + BATCH_SIZE);

          // Build raw values & fingerprints
          // Deduplicate within the chunk to prevent Postgres ON CONFLICT DO UPDATE 21000 errors
          const uniqueByFingerprint = new Map<string, { raw: (typeof chunk)[0]; fingerprint: string }>();
          for (const raw of chunk) {
            const fingerprint = computeAthenaRawFingerprint(raw);
            uniqueByFingerprint.set(fingerprint, { raw, fingerprint });
          }
          const rawItems = Array.from(uniqueByFingerprint.values());

          // Insert raw batch
          const rawCols = [
            'client_caption', 'branch_name', 'client_ticket_no', 'mc_status',
            'call_type', 'nature_of_complaint', 'received_date_raw', 'asp_office_id',
            'outlet_name', 'client_code1', 'client', 'town',
            'area_name', 'outlet_name_address', 'pincode', 'phone',
            'model', 'serial_no', 'asset_no1', 'invoice_no',
            'product_status', 'invoice_date_raw', 'result', 'result_value',
            'addedon_raw', 'ingestion_batch_id', 'raw_fingerprint',
          ];

          const rawValues: unknown[] = [];
          const rawPlaceholders: string[] = [];

          rawItems.forEach((item, rIdx) => {
            const offset = rIdx * rawCols.length;
            rawPlaceholders.push(
              `(${rawCols.map((_, cIdx) => `$${offset + cIdx + 1}`).join(', ')})`
            );
            rawValues.push(
              item.raw.ClientCaption || null,
              item.raw.BRANCHNAME || null,
              item.raw.CLIENTTICKETNO || null,
              item.raw.MCSTATUS || null,
              item.raw.CALLTYPE || null,
              item.raw.NATUREOFCOMPLAINT || null,
              item.raw.RECEIVEDDATE || null,
              item.raw.ASPOFFICEID || null,
              item.raw.OUTLETNAME || null,
              item.raw.CLIENTCODE1 || null,
              item.raw.CLIENT || null,
              item.raw.TOWN || null,
              item.raw.AREANAME || null,
              item.raw.OUTLETNAMEADDRESS || null,
              item.raw.PINCODE || null,
              item.raw.PHONE || null,
              item.raw.MODEL || null,
              item.raw.SERIALNO || null,
              item.raw.ASSETNO1 || null,
              item.raw.INVOICENO || null,
              item.raw.Product_Status || null,
              item.raw.INVOICEDATE || null,
              item.raw.RESULT || null,
              item.raw.RESULT_VALUE || null,
              item.raw.addedon || null,
              batchId,
              item.fingerprint
            );
          });

          await client.query(
            `INSERT INTO athena_failed_calls_raw (${rawCols.join(', ')})
             VALUES ${rawPlaceholders.join(', ')}
             ON CONFLICT (raw_fingerprint) DO UPDATE
               SET ingestion_batch_id = EXCLUDED.ingestion_batch_id`,
            rawValues
          );

          newRawIngested += chunk.length;

          // Prepare normalized batch
          const normCols = [
            'raw_fingerprint', 'client_caption', 'branch_name',
            'client_ticket_no', 'mc_status', 'call_type', 'nature_of_complaint',
            'outlet_name', 'outlet_address', 'pincode', 'phone',
            'model', 'serial_no', 'asset_no', 'invoice_no',
            'product_status', 'result', 'result_value', 'failure_reason',
            'call_date', 'received_date', 'addedon_at',
            'is_valid_matching_data', 'invalid_reason', 'reconciliation_status',
          ];

          const normValues: unknown[] = [];
          const normPlaceholders: string[] = [];

          rawItems.forEach((item, nIdx) => {
            const norm = normalizeAthenaFailedRow(0, item.raw, item.fingerprint);
            if (norm.addedonAt && (!maxAddedon || norm.addedonAt > maxAddedon)) {
              maxAddedon = norm.addedonAt;
            }

            const offset = nIdx * normCols.length;
            normPlaceholders.push(
              `(${normCols.map((_, cIdx) => `$${offset + cIdx + 1}`).join(', ')})`
            );
            normValues.push(
              norm.rawFingerprint,
              norm.clientCaption,
              norm.branchName,
              norm.clientTicketNo,
              norm.mcStatus,
              norm.callType,
              norm.natureOfComplaint,
              norm.outletName,
              norm.outletAddress,
              norm.pincode,
              norm.phone,
              norm.model,
              norm.serialNo,
              norm.assetNo,
              norm.invoiceNo,
              norm.productStatus,
              norm.result,
              norm.resultValue,
              norm.failureReason,
              norm.callDate,
              norm.receivedDate,
              norm.addedonAt,
              norm.isValidMatchingData,
              norm.invalidReason,
              norm.reconciliationStatus
            );
          });

          await client.query(
            `INSERT INTO athena_failed_calls_normalized (${normCols.join(', ')})
             VALUES ${normPlaceholders.join(', ')}
             ON CONFLICT (raw_fingerprint) DO UPDATE SET
               client_caption = EXCLUDED.client_caption,
               branch_name = EXCLUDED.branch_name,
               client_ticket_no = EXCLUDED.client_ticket_no,
               mc_status = EXCLUDED.mc_status,
               call_type = EXCLUDED.call_type,
               nature_of_complaint = EXCLUDED.nature_of_complaint,
               outlet_name = EXCLUDED.outlet_name,
               outlet_address = EXCLUDED.outlet_address,
               pincode = EXCLUDED.pincode,
               phone = EXCLUDED.phone,
               model = EXCLUDED.model,
               serial_no = EXCLUDED.serial_no,
               asset_no = EXCLUDED.asset_no,
               invoice_no = EXCLUDED.invoice_no,
               product_status = EXCLUDED.product_status,
               result = EXCLUDED.result,
               result_value = EXCLUDED.result_value,
               failure_reason = EXCLUDED.failure_reason,
               call_date = EXCLUDED.call_date,
               received_date = EXCLUDED.received_date,
               addedon_at = EXCLUDED.addedon_at,
               is_valid_matching_data = EXCLUDED.is_valid_matching_data,
               invalid_reason = EXCLUDED.invalid_reason,
               updated_at = now()`,
            normValues
          );

          if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= crmRows.length) {
            console.log(
              `[athena-sync] Ingested ${Math.min(i + BATCH_SIZE, crmRows.length)} / ${crmRows.length} rows...`
            );
          }
        }
      });
    }

    // 5. Reconcile all rows so KPIs, matrix, and grid share one matching rule set
    const reconciliationStats = await executeAthenaReconciliation(undefined, {
      reprocessAll: opts?.reprocessAll !== false,
    });

    console.log(
      `[athena-sync] Reconciliation completed: Total ${reconciliationStats.totalProcessed}, Registered: ${reconciliationStats.registered}, Not Registered: ${reconciliationStats.notRegistered}, Multiple: ${reconciliationStats.multipleMatches}, Invalid: ${reconciliationStats.invalidData}`
    );

    // 6. Update sync_state and complete audit run
    await withAppClient(async (client) => {
      await client.query(
        `UPDATE sync_state
         SET last_addedon = COALESCE($1, last_addedon),
             last_run_at = now(),
             is_running = false,
             rows_upserted_last = $2,
             status = 'ok'
         WHERE entity = $3`,
        [maxAddedon, newRawIngested, ENTITY]
      );

      await client.query(
        `UPDATE athena_reconciliation_runs
         SET completed_at = now(),
             status = 'completed',
             total_failed_records = $1,
             registered_count = $2,
             not_registered_count = $3,
             multiple_matches_count = $4,
             invalid_data_count = $5,
             new_raw_ingested = $6
         WHERE run_id = $7`,
        [
          reconciliationStats.totalProcessed,
          reconciliationStats.registered,
          reconciliationStats.notRegistered,
          reconciliationStats.multipleMatches,
          reconciliationStats.invalidData,
          newRawIngested,
          runId,
        ]
      );
    });

    return {
      ok: true,
      batchId,
      runId,
      crmRowsFetched: crmRows.length,
      newRawIngested,
      reconciliationStats,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[athena-sync] Error during sync:`, err);

    await withAppClient(async (client) => {
      await client.query(
        `UPDATE sync_state SET is_running = false, status = 'error' WHERE entity = $1`,
        [ENTITY]
      );

      if (runId > 0) {
        await client.query(
          `UPDATE athena_reconciliation_runs
           SET completed_at = now(),
               status = 'failed',
               error_message = $1
           WHERE run_id = $2`,
          [errorMsg, runId]
        );
      }
    });

    return {
      ok: false,
      batchId,
      runId,
      crmRowsFetched: 0,
      newRawIngested: 0,
      reconciliationStats: {
        totalProcessed: 0,
        registered: 0,
        notRegistered: 0,
        multipleMatches: 0,
        invalidData: 0,
      },
      errorMessage: errorMsg,
    };
  }
}
