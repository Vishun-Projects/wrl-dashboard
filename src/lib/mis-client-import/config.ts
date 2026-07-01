import { withAppClient } from '@/lib/read-model/db';
import type {
  MisClientFieldMapping,
  MisClientSource,
  MisClientSourceConfig,
  MisClientStateMapping,
  MisClientStatusMapping,
} from '@/lib/mis-client-import/types';

type SourceRow = MisClientSource & { id: string };

export type BatchMeta = {
  batchId: string;
  fileName: string;
  rowCount: number;
  activeRows: number;
  supersededRows: number;
  newRows: number;
  uploadedAt: string;
  uploadedByName: string;
  storedFilePath: string | null;
};

export type SourceWithBatches = {
  sourceCode: string;
  sourceName: string;
  fileKind: 'csv' | 'xlsx';
  batches: BatchMeta[];
};

export async function loadSourceConfigByCode(code: string): Promise<MisClientSourceConfig | null> {
  return withAppClient(async (client) => {
    const sourceRes = await client.query<SourceRow>(
      `SELECT id, code, name, file_kind, delimiter, header_row_index, call_key_column,
              crm_account_filter, is_active
       FROM mis_client_sources
       WHERE code = $1 AND is_active = true`,
      [code.toLowerCase()]
    );
    const source = sourceRes.rows[0];
    if (!source) return null;

    const fields = await client.query<MisClientFieldMapping>(
      `SELECT client_column, crm_field, transform
       FROM mis_client_field_mappings WHERE source_id = $1::uuid`,
      [source.id]
    );
    const statuses = await client.query<MisClientStatusMapping>(
      `SELECT client_status, status_bucket, status_label
       FROM mis_client_status_mappings WHERE source_id = $1::uuid`,
      [source.id]
    );
    const states = await client.query<MisClientStateMapping>(
      `SELECT client_state, plan_code, region_override
       FROM mis_client_state_mappings WHERE source_id = $1::uuid`,
      [source.id]
    );

    return {
      ...source,
      fieldMappings: fields.rows,
      statusMappings: statuses.rows,
      stateMappings: states.rows,
    };
  });
}

export async function listActiveSources(): Promise<MisClientSource[]> {
  return withAppClient(async (client) => {
    const res = await client.query<MisClientSource>(
      `SELECT id, code, name, file_kind, delimiter, header_row_index, call_key_column,
              crm_account_filter, is_active
       FROM mis_client_sources
       WHERE is_active = true
       ORDER BY name`
    );
    return res.rows;
  });
}

export async function listSourceBatches(sourceCode: string): Promise<BatchMeta[]> {
  return withAppClient(async (client) => {
    const res = await client.query<{
      batch_id: string;
      file_name: string;
      row_count: number;
      active_rows: number;
      new_rows: number;
      created_at: Date;
      uploader_name: string;
      stored_file_path: string | null;
    }>(
      `
      WITH keyed AS (
        SELECT
          r.batch_id,
          b.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY r.source_id, r.call_key
            ORDER BY b.created_at DESC
          ) AS rn,
          MIN(b.created_at) OVER (PARTITION BY r.source_id, r.call_key) AS first_batch_at
        FROM mis_client_import_rows r
        JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
        JOIN mis_client_sources s ON s.id = r.source_id
        WHERE s.code = $1 AND b.status = 'completed'
      ),
      batch_stats AS (
        SELECT
          batch_id,
          count(*) FILTER (WHERE rn = 1)::int AS active_rows,
          count(*) FILTER (WHERE created_at = first_batch_at)::int AS new_rows
        FROM keyed
        GROUP BY batch_id
      )
      SELECT b.batch_id, b.file_name, b.row_count, b.created_at,
             COALESCE(u.name, 'Unknown') AS uploader_name,
             b.stored_file_path,
             COALESCE(stats.active_rows, 0) AS active_rows,
             COALESCE(stats.new_rows, 0) AS new_rows
      FROM mis_client_import_batches b
      JOIN mis_client_sources s ON s.id = b.source_id
      LEFT JOIN app_users u ON u.id = b.uploaded_by
      LEFT JOIN batch_stats stats ON stats.batch_id = b.batch_id
      WHERE s.code = $1 AND b.status = 'completed'
      ORDER BY b.created_at DESC
      `,
      [sourceCode.toLowerCase()]
    );
    return res.rows.map((row) => ({
      batchId: row.batch_id,
      fileName: row.file_name,
      rowCount: row.row_count,
      activeRows: row.active_rows ?? 0,
      supersededRows: Math.max(0, row.row_count - (row.active_rows ?? 0)),
      newRows: row.new_rows ?? 0,
      uploadedAt: row.created_at.toISOString(),
      uploadedByName: row.uploader_name,
      storedFilePath: row.stored_file_path,
    }));
  });
}

export type ImportAggregateStats = {
  totalRowsInFiles: number;
  totalInUse: number;
  totalSuperseded: number;
  totalNew: number;
  batchCount: number;
};

export function summarizeImportBatches(sources: SourceWithBatches[]): ImportAggregateStats {
  let totalRowsInFiles = 0;
  let totalInUse = 0;
  let totalSuperseded = 0;
  let totalNew = 0;
  let batchCount = 0;
  for (const source of sources) {
    for (const batch of source.batches) {
      batchCount += 1;
      totalRowsInFiles += batch.rowCount;
      totalInUse += batch.activeRows;
      totalSuperseded += batch.supersededRows;
      totalNew += batch.newRows;
    }
  }
  return { totalRowsInFiles, totalInUse, totalSuperseded, totalNew, batchCount };
}

export async function listAllSourcesWithBatches(): Promise<SourceWithBatches[]> {
  const sources = await listActiveSources();
  return Promise.all(
    sources.map(async (source) => ({
      sourceCode: source.code,
      sourceName: source.name,
      fileKind: source.file_kind,
      batches: await listSourceBatches(source.code),
    }))
  );
}

/** @deprecated Use listSourceBatches — kept for compatibility */
export async function getActiveBatchMeta(
  sourceCode: string
): Promise<{
  batchId: string;
  sourceCode: string;
  sourceName: string;
  fileName: string;
  rowCount: number;
  uploadedAt: string;
  uploadedByName: string;
} | null> {
  const batches = await listSourceBatches(sourceCode);
  const latest = batches[0];
  if (!latest) return null;

  const sources = await listActiveSources();
  const source = sources.find((s) => s.code === sourceCode.toLowerCase());
  return {
    batchId: latest.batchId,
    sourceCode: sourceCode.toLowerCase(),
    sourceName: source?.name ?? sourceCode,
    fileName: latest.fileName,
    rowCount: latest.rowCount,
    uploadedAt: latest.uploadedAt,
    uploadedByName: latest.uploadedByName,
  };
}

/** @deprecated No longer used — aggregation queries all batches with latest-wins */
export async function getActiveBatchId(sourceCode: string): Promise<string | null> {
  const meta = await getActiveBatchMeta(sourceCode);
  return meta?.batchId ?? null;
}

export type SourceConfigPayload = {
  code: string;
  name: string;
  file_kind: 'csv' | 'xlsx';
  delimiter?: string | null;
  header_row_index: number;
  call_key_column: string;
  crm_account_filter?: string | null;
  fieldMappings: MisClientFieldMapping[];
  statusMappings: MisClientStatusMapping[];
  stateMappings: MisClientStateMapping[];
};

export async function upsertSourceConfig(payload: SourceConfigPayload): Promise<MisClientSourceConfig> {
  const code = payload.code.trim().toLowerCase();
  if (!code || !payload.name.trim() || !payload.call_key_column.trim()) {
    throw new Error('code, name, and call_key_column are required');
  }

  await withAppClient(async (client) => {
    const sourceRes = await client.query<SourceRow>(
      `
      INSERT INTO mis_client_sources
        (code, name, file_kind, delimiter, header_row_index, call_key_column, crm_account_filter, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        file_kind = EXCLUDED.file_kind,
        delimiter = EXCLUDED.delimiter,
        header_row_index = EXCLUDED.header_row_index,
        call_key_column = EXCLUDED.call_key_column,
        crm_account_filter = EXCLUDED.crm_account_filter,
        is_active = true
      RETURNING id, code, name, file_kind, delimiter, header_row_index, call_key_column, crm_account_filter, is_active
      `,
      [
        code,
        payload.name.trim(),
        payload.file_kind,
        payload.delimiter ?? null,
        payload.header_row_index,
        payload.call_key_column.trim(),
        payload.crm_account_filter?.trim() || null,
      ]
    );
    const source = sourceRes.rows[0];
    const sourceId = source.id;

    await client.query(`DELETE FROM mis_client_field_mappings WHERE source_id = $1::uuid`, [sourceId]);
    for (const m of payload.fieldMappings) {
      if (!m.client_column?.trim() || !m.crm_field?.trim()) continue;
      await client.query(
        `INSERT INTO mis_client_field_mappings (source_id, client_column, crm_field, transform)
         VALUES ($1::uuid, $2, $3, $4::jsonb)`,
        [sourceId, m.client_column.trim(), m.crm_field.trim(), m.transform ? JSON.stringify(m.transform) : null]
      );
    }

    await client.query(`DELETE FROM mis_client_status_mappings WHERE source_id = $1::uuid`, [sourceId]);
    for (const m of payload.statusMappings) {
      if (!m.client_status?.trim()) continue;
      await client.query(
        `INSERT INTO mis_client_status_mappings (source_id, client_status, status_bucket, status_label)
         VALUES ($1::uuid, $2, $3::status_bucket_type, $4)`,
        [sourceId, m.client_status.trim(), m.status_bucket, m.status_label.trim()]
      );
    }

    await client.query(`DELETE FROM mis_client_state_mappings WHERE source_id = $1::uuid`, [sourceId]);
    for (const m of payload.stateMappings) {
      if (!m.client_state?.trim()) continue;
      await client.query(
        `INSERT INTO mis_client_state_mappings (source_id, client_state, plan_code, region_override)
         VALUES ($1::uuid, $2, $3, $4)`,
        [sourceId, m.client_state.trim(), m.plan_code ?? null, m.region_override ?? null]
      );
    }

  });

  const config = await loadSourceConfigByCode(code);
  if (!config) throw new Error('Failed to load saved source config');
  return config;
}
