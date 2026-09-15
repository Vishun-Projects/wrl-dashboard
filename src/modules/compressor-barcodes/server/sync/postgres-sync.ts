import { postQuery } from '@/lib/db/proxy';
import {
  buildCompressorBarcodesListRawSql,
  buildCompressorBarcodesModifiedSerialsSql,
} from '@/sql/compressor-barcodes/query';
import { withClient } from '@/lib/read-model/db';

export interface ProcessedCompressorBarcode {
  serial_number: string;
  call_no: string;
  call_date: Date;
  office_name: string;
  branch_name: string | null;
  sap_vendor_code: string | null;
  old_item_code: string | null;
  old_item_name: string | null;
  new_item_code: string | null;
  new_item_name: string | null;
  derived_old_barcode: string;
  derived_new_barcode: string;
  call_status: string;
  cancel_reason: string | null;
  solve_date: Date | null;
  days_gap: number | null;
  is_continuity_broken: boolean;
  expected_old_barcode: string | null;
}

function cleanBarcode(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s || s === '-') return '';
  const lower = s.toLowerCase();
  if (
    lower === 'nil' ||
    lower === 'nill' ||
    lower === 'null' ||
    lower === 'missing' ||
    lower === 'na' ||
    lower === 'n/a' ||
    lower === 'n a' ||
    lower === 'no' ||
    lower === 'not' ||
    lower === 'none' ||
    lower === '#valuebarcode#' ||
    lower.includes('missing') ||
    lower.includes('not available') ||
    lower.includes('not visible') ||
    lower.includes('not found') ||
    lower.includes('nobarcode') ||
    lower.includes('no barcode') ||
    lower.includes('barcode missing') ||
    lower.includes('bar code missing') ||
    lower.includes('not clear') ||
    lower.includes('not able') ||
    lower.includes('damaged') ||
    lower.includes('sticker dem')
  ) {
    return '';
  }
  return s;
}

async function ensureCompressorBarcodesTable(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS compressor_barcodes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      serial_number TEXT NOT NULL,
      call_no TEXT NOT NULL,
      call_date TIMESTAMPTZ NOT NULL,
      office_name TEXT,
      derived_old_barcode TEXT,
      derived_new_barcode TEXT,
      call_status TEXT NOT NULL DEFAULT 'Closed',
      cancel_reason TEXT,
      is_continuity_broken BOOLEAN NOT NULL DEFAULT false,
      expected_old_barcode TEXT,
      branch_name TEXT,
      sap_vendor_code TEXT,
      old_item_code TEXT,
      old_item_name TEXT,
      new_item_code TEXT,
      new_item_name TEXT,
      solve_date TIMESTAMPTZ,
      days_gap INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT compressor_barcodes_serial_call_uq UNIQUE (serial_number, call_no)
    );

    CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_serial ON compressor_barcodes (serial_number);
    CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_call_date ON compressor_barcodes (call_date);
    CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_solve_date ON compressor_barcodes (solve_date);
    CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_call_no ON compressor_barcodes (call_no);
    CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_broken ON compressor_barcodes (is_continuity_broken) WHERE is_continuity_broken = true;

    CREATE TABLE IF NOT EXISTS sync_state (
      entity TEXT PRIMARY KEY,
      last_editedon TIMESTAMPTZ,
      last_synced TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO sync_state (entity) VALUES ('compressor_barcodes') ON CONFLICT (entity) DO NOTHING;
  `);
}

export async function syncCompressorBarcodesToPostgres(opts?: {
  forceFull?: boolean;
}): Promise<{ success: boolean; count: number; mode: string }> {
  console.log('[Sync] Starting compressor barcodes sync...');

  const lastWatermark: Date | null = await withClient(async (client) => {
    await ensureCompressorBarcodesTable(client);
    if (!opts?.forceFull) {
      const stateRes = await client.query<{ last_editedon: Date | null }>(
        `SELECT last_editedon FROM sync_state WHERE entity = 'compressor_barcodes'`
      );
      return stateRes.rows[0]?.last_editedon ? new Date(stateRes.rows[0].last_editedon) : null;
    }
    return null;
  });

  let rawRows: Record<string, unknown>[] = [];
  let isIncremental = false;

  // 1. If watermark exists, query only serial numbers modified since watermark (with 5-min overlap)
  if (lastWatermark && !opts?.forceFull) {
    const overlapDate = new Date(lastWatermark.getTime() - 5 * 60 * 1000);
    const sinceStr = overlapDate.toISOString().replace('T', ' ').substring(0, 19);

    console.log(`[Sync] Checking CRM for compressor calls modified since ${sinceStr}...`);
    const modRes = await postQuery({
      rawSql: buildCompressorBarcodesModifiedSerialsSql(sinceStr),
      timeoutMs: 30000,
    });

    const modifiedSerials = Array.from(
      new Set(
        ((modRes.data || []) as Array<{ serial_number: string }>)
          .map((r) => String(r.serial_number || '').trim())
          .filter(Boolean)
      )
    );

    if (modifiedSerials.length === 0) {
      console.log(`[Sync] No modified compressor calls found since ${sinceStr}. Database is up to date.`);
      await withClient(async (client) => {
        await client.query(`
          INSERT INTO sync_state (entity, last_editedon, last_run_at, status, rows_upserted_last)
          VALUES ('compressor_barcodes', now(), now(), 'ok', 0)
          ON CONFLICT (entity) DO UPDATE SET
            last_run_at = EXCLUDED.last_run_at,
            status = EXCLUDED.status,
            rows_upserted_last = 0;
        `);
      });
      return { success: true, count: 0, mode: 'incremental-skipped' };
    }

    console.log(`[Sync] Found ${modifiedSerials.length} modified serial numbers. Fetching complete lineage...`);
    isIncremental = true;
    const CHUNK_SIZE = 100;
    for (let i = 0; i < modifiedSerials.length; i += CHUNK_SIZE) {
      const chunk = modifiedSerials.slice(i, i + CHUNK_SIZE);
      const res = await postQuery({
        rawSql: buildCompressorBarcodesListRawSql({ serials: chunk }),
        timeoutMs: 60000,
      });
      if (res.data) {
        rawRows.push(...(res.data as Record<string, unknown>[]));
      }
    }
  } else {
    // Full sync
    console.log('[Sync] Running full baseline CRM query...');
    const res = await postQuery({
      rawSql: buildCompressorBarcodesListRawSql(),
      timeoutMs: 120000,
    });
    rawRows = (res.data || []) as Record<string, unknown>[];
  }

  if (!rawRows.length) {
    console.log('[Sync] No compressor barcodes found in CRM.');
    return { success: true, count: 0, mode: isIncremental ? 'incremental' : 'full' };
  }

  console.log(`[Sync] Retrieved ${rawRows.length} raw rows from CRM (${isIncremental ? 'incremental' : 'full'}).`);

  // 2. Group by serial_number -> distinct calls (collapsing duplicate parts rows per call)
  const serialMap = new Map<string, Map<string, Record<string, unknown>>>();

  for (const row of rawRows) {
    const serial = String(row.serial_number || '').trim();
    if (!serial) continue;

    const callNo = String(row.call_no || '').trim();
    if (!callNo) continue;

    if (!serialMap.has(serial)) {
      serialMap.set(serial, new Map());
    }
    const callsForSerial = serialMap.get(serial)!;

    const candidateNew = cleanBarcode(row.s_newbarcode || row.p_newbarcode || row.s_serialno);
    const candidateOld = cleanBarcode(row.s_oldbarcode || row.p_oldbarcode);
    const callStatus = String(row.call_status || 'Open').trim();
    const cancelReason = row.cancel_reason ? String(row.cancel_reason).trim() : null;

    const existing = callsForSerial.get(callNo);
    if (!existing) {
      callsForSerial.set(callNo, {
        ...row,
        call_no: callNo,
        resolved_new: candidateNew,
        resolved_old: candidateOld,
        call_status: callStatus,
        cancel_reason: cancelReason,
      });
    } else {
      if (!existing.resolved_new && candidateNew) {
        existing.resolved_new = candidateNew;
      }
      if (!existing.resolved_old && candidateOld) {
        existing.resolved_old = candidateOld;
      }
      if (!existing.cancel_reason && cancelReason) {
        existing.cancel_reason = cancelReason;
      }
      if (callStatus === 'Cancelled') {
        existing.call_status = 'Cancelled';
      } else if (existing.call_status !== 'Cancelled') {
        const priority: Record<string, number> = {
          'Closed': 4,
          'Tech Solved': 3,
          'Assigned': 2,
          'Transferred': 2,
          'Open': 1,
        };
        const curPri = priority[String(existing.call_status)] || 0;
        const newPri = priority[callStatus] || 0;
        if (newPri > curPri || !existing.call_status) {
          existing.call_status = callStatus;
        }
      }
      if (!existing.solve_date && row.solve_date) {
        existing.solve_date = row.solve_date;
      }
      if (!existing.new_item_code && row.new_item_code) {
        existing.new_item_code = row.new_item_code;
        existing.new_item_name = row.new_item_name;
      }
      if (!existing.old_item_code && row.old_item_code) {
        existing.old_item_code = row.old_item_code;
        existing.old_item_name = row.old_item_name;
      }
      if (!existing.branch_name && row.branch_name) {
        existing.branch_name = row.branch_name;
      }
      if (!existing.sap_vendor_code && row.sap_vendor_code) {
        existing.sap_vendor_code = row.sap_vendor_code;
      }
    }
  }

  // 3. Process chronological barcode derivation chain and days gap per serial_number
  const processedRows: ProcessedCompressorBarcode[] = [];

  for (const [serial, callsMap] of serialMap.entries()) {
    const calls = Array.from(callsMap.values());
    // Sort calls chronologically by call_date (or solve_date)
    calls.sort((a, b) => {
      const dateA = new Date(String(a.call_date || 0)).getTime();
      const dateB = new Date(String(b.call_date || 0)).getTime();
      return dateA - dateB;
    });

    let previousNewBarcode = '';
    let lastSolvedDate: Date | null = null;
    const barcodeItemMap = new Map<string, { code: string | null; name: string | null }>();

    for (const call of calls) {
      const crmNew = cleanBarcode(call.resolved_new || call.s_newbarcode || call.p_newbarcode);
      const crmOld = cleanBarcode(call.resolved_old || call.s_oldbarcode || call.p_oldbarcode);

      let isContinuityBroken = false;
      let expectedOldBarcode: string | null = null;

      // Detect continuity break: technician reports old barcode that does NOT match previously installed compressor
      if (previousNewBarcode) {
        if (crmOld && crmOld !== previousNewBarcode) {
          isContinuityBroken = true;
          expectedOldBarcode = previousNewBarcode;
        }
      }

      // Prefer technician's entered old barcode from CRM, fallback to chronological chain
      const oldBarcode = crmOld || previousNewBarcode || '';
      const newBarcode = crmNew || '-';
      const callStatus = String(call.call_status || 'Open').trim();
      const cancelReason = call.cancel_reason ? String(call.cancel_reason).trim() : null;

      // New item code and name (only if a valid new barcode was replaced/installed)
      const hasValidNewBarcode = Boolean(newBarcode && newBarcode !== '-');
      const resolvedNewCode = hasValidNewBarcode && call.new_item_code ? String(call.new_item_code).trim() : null;
      const resolvedNewName = hasValidNewBarcode && call.new_item_name ? String(call.new_item_name).trim() : null;

      if (hasValidNewBarcode) {
        barcodeItemMap.set(newBarcode, { code: resolvedNewCode, name: resolvedNewName });
      }

      // Old item code and name:
      // If there is NO old barcode (Initial / Blank), old item code/name MUST be null!
      let resolvedOldCode: string | null = null;
      let resolvedOldName: string | null = null;

      if (oldBarcode && oldBarcode !== '-') {
        const prevInstalled = barcodeItemMap.get(oldBarcode);
        if (prevInstalled && (prevInstalled.code || prevInstalled.name)) {
          resolvedOldCode = prevInstalled.code;
          resolvedOldName = prevInstalled.name;
        } else if (crmOld && (call.old_item_code || call.old_item_name)) {
          const isSameAsNew = call.old_item_code && call.new_item_code && String(call.old_item_code).trim() === String(call.new_item_code).trim();
          if (!isSameAsNew) {
            resolvedOldCode = call.old_item_code ? String(call.old_item_code).trim() : null;
            resolvedOldName = call.old_item_name ? String(call.old_item_name).trim() : null;
          }
        }
      }

      // Parse solve date
      let parsedSolveDate: Date | null = null;
      if (call.solve_date) {
        const d = new Date(String(call.solve_date));
        if (!isNaN(d.getTime())) {
          parsedSolveDate = d;
        }
      }

      // Calculate days gap:
      // If call is cancelled, days_gap is null (NA) and we DO NOT update lastSolvedDate (skip till next call)
      let daysGap: number | null = null;
      if (callStatus === 'Cancelled') {
        daysGap = null;
      } else {
        const effectiveCurrentDate = parsedSolveDate || new Date(String(call.call_date));
        if (!isNaN(effectiveCurrentDate.getTime())) {
          if (lastSolvedDate) {
            const diffMs = effectiveCurrentDate.getTime() - lastSolvedDate.getTime();
            daysGap = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
          }
          // Only advance lastSolvedDate if call is solved (Closed or Tech Solved) or has solve date
          if (parsedSolveDate || callStatus === 'Closed' || callStatus === 'Tech Solved') {
            lastSolvedDate = effectiveCurrentDate;
          }
        }
      }

      processedRows.push({
        serial_number: serial,
        call_no: String(call.call_no).trim(),
        call_date: new Date(String(call.call_date || new Date().toISOString())),
        office_name: String(call.office_name || ''),
        branch_name: call.branch_name ? String(call.branch_name).trim() : null,
        sap_vendor_code: call.sap_vendor_code ? String(call.sap_vendor_code).trim() : null,
        old_item_code: resolvedOldCode,
        old_item_name: resolvedOldName,
        new_item_code: resolvedNewCode,
        new_item_name: resolvedNewName,
        derived_old_barcode: oldBarcode,
        derived_new_barcode: newBarcode,
        call_status: callStatus,
        cancel_reason: cancelReason,
        solve_date: parsedSolveDate,
        days_gap: daysGap,
        is_continuity_broken: isContinuityBroken,
        expected_old_barcode: expectedOldBarcode,
      });

      // Advance barcode chain only if a new barcode was installed
      if (crmNew) {
        previousNewBarcode = crmNew;
      }
    }
  }

  console.log(`[Sync] Processed ${processedRows.length} distinct call records across ${serialMap.size} serial numbers. Saving to Postgres...`);

  // 4. Batch upsert into Postgres using withClient
  let totalUpserted = 0;
  const BATCH_SIZE = 300;

  await withClient(async (client) => {
    // Remove any legacy synthetic CALL- records from previous syncs
    await client.query(`DELETE FROM compressor_barcodes WHERE call_no LIKE 'CALL-%';`);

    // Remove practice, WinMax, and head office dummy records
    await client.query(`
      DELETE FROM compressor_barcodes 
      WHERE office_name ~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)';
    `);

    for (let i = 0; i < processedRows.length; i += BATCH_SIZE) {
      const batch = processedRows.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const valueClauses: string[] = [];

      batch.forEach((row, idx) => {
        const base = idx * 18;
        valueClauses.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18})`
        );
        values.push(
          row.serial_number,
          row.call_no,
          row.call_date,
          row.office_name,
          row.branch_name,
          row.sap_vendor_code,
          row.old_item_code,
          row.old_item_name,
          row.new_item_code,
          row.new_item_name,
          row.derived_old_barcode,
          row.derived_new_barcode,
          row.call_status,
          row.cancel_reason,
          row.solve_date,
          row.days_gap,
          row.is_continuity_broken,
          row.expected_old_barcode
        );
      });

      const sql = `
        INSERT INTO compressor_barcodes (
          serial_number,
          call_no,
          call_date,
          office_name,
          branch_name,
          sap_vendor_code,
          old_item_code,
          old_item_name,
          new_item_code,
          new_item_name,
          derived_old_barcode,
          derived_new_barcode,
          call_status,
          cancel_reason,
          solve_date,
          days_gap,
          is_continuity_broken,
          expected_old_barcode
        )
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (serial_number, call_no) DO UPDATE SET
          call_date = EXCLUDED.call_date,
          office_name = EXCLUDED.office_name,
          branch_name = EXCLUDED.branch_name,
          sap_vendor_code = EXCLUDED.sap_vendor_code,
          old_item_code = EXCLUDED.old_item_code,
          old_item_name = EXCLUDED.old_item_name,
          new_item_code = EXCLUDED.new_item_code,
          new_item_name = EXCLUDED.new_item_name,
          derived_old_barcode = EXCLUDED.derived_old_barcode,
          derived_new_barcode = EXCLUDED.derived_new_barcode,
          call_status = EXCLUDED.call_status,
          cancel_reason = EXCLUDED.cancel_reason,
          solve_date = EXCLUDED.solve_date,
          days_gap = EXCLUDED.days_gap,
          is_continuity_broken = EXCLUDED.is_continuity_broken,
          expected_old_barcode = EXCLUDED.expected_old_barcode,
          updated_at = now()
        WHERE compressor_barcodes.call_status IS DISTINCT FROM EXCLUDED.call_status
           OR compressor_barcodes.solve_date IS DISTINCT FROM EXCLUDED.solve_date
           OR compressor_barcodes.days_gap IS DISTINCT FROM EXCLUDED.days_gap
           OR compressor_barcodes.derived_old_barcode IS DISTINCT FROM EXCLUDED.derived_old_barcode
           OR compressor_barcodes.derived_new_barcode IS DISTINCT FROM EXCLUDED.derived_new_barcode
           OR compressor_barcodes.is_continuity_broken IS DISTINCT FROM EXCLUDED.is_continuity_broken
           OR compressor_barcodes.cancel_reason IS DISTINCT FROM EXCLUDED.cancel_reason
           OR compressor_barcodes.old_item_code IS DISTINCT FROM EXCLUDED.old_item_code
           OR compressor_barcodes.old_item_name IS DISTINCT FROM EXCLUDED.old_item_name
           OR compressor_barcodes.new_item_code IS DISTINCT FROM EXCLUDED.new_item_code
           OR compressor_barcodes.new_item_name IS DISTINCT FROM EXCLUDED.new_item_name
           OR compressor_barcodes.office_name IS DISTINCT FROM EXCLUDED.office_name
           OR compressor_barcodes.branch_name IS DISTINCT FROM EXCLUDED.branch_name
           OR compressor_barcodes.sap_vendor_code IS DISTINCT FROM EXCLUDED.sap_vendor_code;
      `;

      const result = await client.query(sql, values);
      totalUpserted += result.rowCount || 0;
      if (totalUpserted % 5000 === 0 || totalUpserted === processedRows.length) {
        console.log(`[Sync] Upserted/checked ${totalUpserted} / ${processedRows.length} records...`);
      }
    }

    // Ensure null consistency for blank barcodes
    await client.query(`
      UPDATE compressor_barcodes 
      SET old_item_code = NULL, old_item_name = NULL 
      WHERE derived_old_barcode = '' OR derived_old_barcode IS NULL OR derived_old_barcode = '-';

      UPDATE compressor_barcodes 
      SET new_item_code = NULL, new_item_name = NULL 
      WHERE derived_new_barcode = '-' OR derived_new_barcode IS NULL OR derived_new_barcode = '';
    `);

    // Update watermark in sync_state
    await client.query(`
      INSERT INTO sync_state (entity, last_editedon, last_run_at, status, rows_upserted_last)
      VALUES ('compressor_barcodes', now(), now(), 'ok', $1)
      ON CONFLICT (entity) DO UPDATE SET
        last_editedon = EXCLUDED.last_editedon,
        last_run_at = EXCLUDED.last_run_at,
        status = EXCLUDED.status,
        rows_upserted_last = EXCLUDED.rows_upserted_last;
    `, [totalUpserted]);
  });

  console.log(`[Sync] Compressor barcodes sync complete! Mode: ${isIncremental ? 'incremental' : 'full'}, Upserted: ${totalUpserted}`);
  return { success: true, count: totalUpserted, mode: isIncremental ? 'incremental' : 'full' };
}


