import { withAppClient } from '@/lib/read-model/db';
import { handleMisClientUploadBuffer } from '@/lib/mis-client-import/upload-http';
import { MIS_UPLOAD_CHUNK_BYTES } from '@/lib/mis-client-import/upload-chunk-constants';

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
        file_name = EXCLUDED.file_name,
        created_at = now()
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

export async function assembleAndProcessUpload(uploadId: string, uploadedBy: string) {
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
    await client.query(`DELETE FROM mis_client_import_upload_chunks WHERE upload_id = $1::uuid`, [
      uploadId,
    ]);

    return handleMisClientUploadBuffer({
      userId: uploadedBy,
      sourceCode: meta.source_code,
      fileName: meta.file_name,
      buffer,
    });
  });
}

export async function purgeStaleUploadChunks(): Promise<number> {
  return withAppClient(async (client) => {
    const res = await client.query(
      `DELETE FROM mis_client_import_upload_chunks WHERE created_at < now() - interval '2 hours'`
    );
    return res.rowCount ?? 0;
  });
}
