import { withAppClient } from '@/lib/read-model/db';
import {
  handleMisClientUploadBuffer,
  type MisUploadAuditContext,
  type MisUploadHttpResult,
} from '@/features/mis-import/lib/upload-http';

export async function storeUploadChunk(params: {
  uploadId: string;
  chunkIndex: number;
  chunkTotal: number;
  sourceCode: string;
  fileName: string;
  uploadedBy: string;
  data: Buffer;
}): Promise<void> {
  await withAppClient(async (client) => {
    await client.query(
      `
      INSERT INTO mis_client_import_upload_chunks
        (upload_id, chunk_index, chunk_total, source_code, file_name, uploaded_by, data)
      VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7)
      ON CONFLICT (upload_id, chunk_index) DO UPDATE SET
        data = EXCLUDED.data,
        chunk_total = EXCLUDED.chunk_total,
        source_code = EXCLUDED.source_code,
        file_name = EXCLUDED.file_name
      `,
      [
        params.uploadId,
        params.chunkIndex,
        params.chunkTotal,
        params.sourceCode,
        params.fileName,
        params.uploadedBy,
        params.data,
      ]
    );
  });
}

type AssembledUpload = {
  sourceCode: string;
  fileName: string;
  buffer: Buffer;
  startedAt: Date;
};

async function readAssembledUpload(
  uploadId: string,
  uploadedBy: string
): Promise<{ status: number; body: Record<string, unknown> } | AssembledUpload> {
  return withAppClient(async (client) => {
    const metaRes = await client.query<{
      chunk_total: number;
      source_code: string;
      file_name: string;
      uploaded_by: string;
      started_at: Date;
    }>(
      `
      SELECT chunk_total, source_code, file_name, uploaded_by,
             MIN(created_at) AS started_at
      FROM mis_client_import_upload_chunks
      WHERE upload_id = $1::uuid
      GROUP BY chunk_total, source_code, file_name, uploaded_by
      LIMIT 1
      `,
      [uploadId]
    );
    const meta = metaRes.rows[0];
    if (!meta) {
      return { status: 404, body: { error: 'Upload session not found' } };
    }
    if (meta.uploaded_by !== uploadedBy) {
      return { status: 403, body: { error: 'Forbidden' } };
    }

    const chunksRes = await client.query<{ chunk_index: number; data: Buffer }>(
      `
      SELECT chunk_index, data
      FROM mis_client_import_upload_chunks
      WHERE upload_id = $1::uuid
      ORDER BY chunk_index
      `,
      [uploadId]
    );

    if (chunksRes.rows.length !== meta.chunk_total) {
      return {
        status: 400,
        body: {
          error: `Missing chunks: received ${chunksRes.rows.length} of ${meta.chunk_total}`,
        },
      };
    }

    const buffer = Buffer.concat(chunksRes.rows.map((row) => row.data));
    return {
      sourceCode: meta.source_code,
      fileName: meta.file_name,
      buffer,
      startedAt: meta.started_at,
    };
  });
}

export async function deleteUploadChunks(uploadId: string): Promise<void> {
  await withAppClient(async (client) => {
    await client.query(`DELETE FROM mis_client_import_upload_chunks WHERE upload_id = $1::uuid`, [
      uploadId,
    ]);
  });
}

export async function getUploadChunkStatus(params: {
  uploadId: string;
  uploadedBy: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  return withAppClient(async (client) => {
    const metaRes = await client.query<{
      chunk_total: number;
      source_code: string;
      file_name: string;
      uploaded_by: string;
    }>(
      `
      SELECT chunk_total, source_code, file_name, uploaded_by
      FROM mis_client_import_upload_chunks
      WHERE upload_id = $1::uuid
      ORDER BY chunk_index
      LIMIT 1
      `,
      [params.uploadId]
    );
    const meta = metaRes.rows[0];
    if (!meta) {
      return { status: 404, body: { error: 'Upload session not found', received: [], chunkTotal: 0 } };
    }
    if (meta.uploaded_by !== params.uploadedBy) {
      return { status: 403, body: { error: 'Forbidden' } };
    }

    const chunksRes = await client.query<{ chunk_index: number }>(
      `
      SELECT chunk_index
      FROM mis_client_import_upload_chunks
      WHERE upload_id = $1::uuid
      ORDER BY chunk_index
      `,
      [params.uploadId]
    );

    return {
      status: 200,
      body: {
        uploadId: params.uploadId,
        received: chunksRes.rows.map((row) => row.chunk_index),
        chunkTotal: meta.chunk_total,
        sourceCode: meta.source_code,
        fileName: meta.file_name,
      },
    };
  });
}

export async function assembleAndProcessUpload(
  uploadId: string,
  uploadedBy: string,
  contentEncoding?: string | null,
  audit?: MisUploadAuditContext | null
): Promise<MisUploadHttpResult> {
  const assembled = await readAssembledUpload(uploadId, uploadedBy);
  if ('status' in assembled) {
    return assembled;
  }

  const result = await handleMisClientUploadBuffer({
    userId: uploadedBy,
    sourceCode: assembled.sourceCode,
    fileName: assembled.fileName,
    buffer: assembled.buffer,
    contentEncoding,
    audit,
    skipStartLog: true,
    startedAtMs: assembled.startedAt.getTime(),
    uploadId,
  });

  if (result.status === 200) {
    await deleteUploadChunks(uploadId);
  }

  return result;
}

export async function purgeStaleUploadChunks(): Promise<number> {
  return withAppClient(async (client) => {
    const res = await client.query(
      `DELETE FROM mis_client_import_upload_chunks WHERE created_at < now() - interval '2 hours'`
    );
    return res.rowCount ?? 0;
  });
}
