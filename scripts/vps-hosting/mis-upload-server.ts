#!/usr/bin/env npx tsx
/**
 * Large-file MIS upload/download server for VPS (bypasses Vercel body/egress limits).
 * Run behind Caddy with client_max_body_size 320m.
 *
 *   MIS_UPLOAD_PORT=3099 npx tsx scripts/vps-hosting/mis-upload-server.ts
 *
 * Routes:
 *   POST /api/mis-client-import/upload
 *   GET|POST /api/mis-client-import/upload-chunk
 *   GET /api/mis-client-import/batches/:batchId/download
 */
import { config } from 'dotenv';
import { createServer } from 'http';
import { Readable } from 'stream';
import { resolve } from 'path';
import { handleMisClientUploadFormData } from '@/features/mis-import/lib/upload-http';
import {
  handleMisClientUploadChunkFormData,
  handleMisClientUploadChunkStatus,
} from '@/features/mis-import/lib/upload-chunk-http';
import { resolveMisBatchDownload } from '@/features/mis-import/lib/batch-download-http';
import {
  assertMisDownloadAccess,
  assertMisUploadAccess,
  resolveMisUploadUserId,
} from '@/features/mis-import/lib/upload-standalone-auth';

const root = resolve(__dirname, '../..');
config({ path: resolve(root, '.env.mis-upload') });
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.mis-email') });
config({ path: resolve(root, '.env.sync-worker') });

const PORT = Number(process.env.MIS_UPLOAD_PORT ?? 3099);
const UPLOAD_PATH = '/api/mis-client-import/upload';
const CHUNK_PATH = '/api/mis-client-import/upload-chunk';
const BATCH_DOWNLOAD_RE = /^\/api\/mis-client-import\/batches\/([^/]+)\/download\/?$/;

const ALLOWED_ORIGINS = new Set(
  (process.env.MIS_UPLOAD_CORS_ORIGINS ??
    'https://wrl-dashboard.vercel.app,https://www.wrl-fsm.cloud,https://wrl-fsm.cloud,http://localhost:3000')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);

function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers':
      'Content-Disposition, Content-Length, Accept-Ranges, Content-Range, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function parseUrl(reqUrl: string | undefined): { pathname: string; searchParams: URLSearchParams } {
  const u = new URL(reqUrl ?? '/', 'http://127.0.0.1');
  return { pathname: u.pathname, searchParams: u.searchParams };
}

async function readFormData(
  req: import('http').IncomingMessage,
  pathname: string
): Promise<FormData> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value[0] : value);
  }
  const request = new Request(`http://127.0.0.1${pathname}`, {
    method: 'POST',
    headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    // @ts-expect-error Node fetch requires duplex for streaming bodies
    duplex: 'half',
  });
  return request.formData();
}

async function resolveAuthedUserId(
  req: import('http').IncomingMessage,
  formData?: FormData,
  mode: 'upload' | 'download' = 'upload'
): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token && formData) {
    const fromForm = formData.get('accessToken');
    if (typeof fromForm === 'string' && fromForm.trim()) {
      token = fromForm.trim();
    }
  }

  if (!token) {
    return { userId: null, error: 'Unauthorized — missing session token' };
  }

  const userId = await resolveMisUploadUserId(token);
  if (!userId) {
    return { userId: null, error: 'Unauthorized — invalid or expired session' };
  }

  const allowed =
    mode === 'download'
      ? await assertMisDownloadAccess(userId)
      : await assertMisUploadAccess(userId);
  if (!allowed) {
    return {
      userId: null,
      error:
        mode === 'download'
          ? 'Forbidden — missing MIS reports access'
          : 'Forbidden — missing client import permission',
    };
  }

  return { userId };
}

createServer(async (req, res) => {
  const origin = req.headers.origin;
  const baseHeaders = corsHeaders(origin);
  const { pathname, searchParams } = parseUrl(req.url);
  const downloadMatch = BATCH_DOWNLOAD_RE.exec(pathname);

  if (
    req.method === 'OPTIONS' &&
    (pathname === UPLOAD_PATH || pathname === CHUNK_PATH || downloadMatch)
  ) {
    res.writeHead(204, baseHeaders);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && downloadMatch) {
      const batchId = decodeURIComponent(downloadMatch[1] ?? '').trim();
      if (!batchId) {
        res.writeHead(400, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'batchId is required' }));
        return;
      }
      const auth = await resolveAuthedUserId(req, undefined, 'download');
      if (!auth.userId) {
        const status = auth.error?.startsWith('Forbidden') ? 403 : 401;
        res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: auth.error ?? 'Unauthorized' }));
        return;
      }
      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : null;
      const result = await resolveMisBatchDownload({ batchId, rangeHeader });
      res.writeHead(result.status, { ...baseHeaders, ...result.headers });
      if (result.kind === 'stream') {
        result.stream.on('error', (err) => {
          console.error('[mis-upload-server] download stream error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { ...baseHeaders, 'Content-Type': 'application/json' });
          }
          res.end();
        });
        result.stream.pipe(res);
        return;
      }
      res.end(result.buffer);
      return;
    }

    if (req.method === 'GET' && pathname === CHUNK_PATH) {
      const uploadId = searchParams.get('uploadId')?.trim() ?? '';
      if (!uploadId) {
        res.writeHead(400, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'uploadId is required' }));
        return;
      }
      const auth = await resolveAuthedUserId(req);
      if (!auth.userId) {
        const status = auth.error?.startsWith('Forbidden') ? 403 : 401;
        res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: auth.error ?? 'Unauthorized' }));
        return;
      }
      const result = await handleMisClientUploadChunkStatus({
        userId: auth.userId,
        uploadId,
      });
      res.writeHead(result.status, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }

    if (req.method === 'POST' && pathname === CHUNK_PATH) {
      const formData = await readFormData(req, CHUNK_PATH);
      const auth = await resolveAuthedUserId(req, formData);
      if (!auth.userId) {
        const status = auth.error?.startsWith('Forbidden') ? 403 : 401;
        res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: auth.error ?? 'Unauthorized' }));
        return;
      }
      const result = await handleMisClientUploadChunkFormData({
        userId: auth.userId,
        formData,
      });
      res.writeHead(result.status, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }

    if (req.method === 'POST' && pathname === UPLOAD_PATH) {
      const formData = await readFormData(req, UPLOAD_PATH);
      const auth = await resolveAuthedUserId(req, formData);
      if (!auth.userId) {
        console.warn('[mis-upload-server] auth failed:', auth.error);
        const status = auth.error?.startsWith('Forbidden') ? 403 : 401;
        res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: auth.error ?? 'Unauthorized' }));
        return;
      }
      const result = await handleMisClientUploadFormData({ userId: auth.userId, formData });
      res.writeHead(result.status, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }

    res.writeHead(404, { ...baseHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mis-upload-server] error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Request failed',
          detail: message.slice(0, 500),
        })
      );
    } else {
      res.end();
    }
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[mis-upload-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mis-upload-server]   POST ${UPLOAD_PATH}`);
  console.log(`[mis-upload-server]   GET|POST ${CHUNK_PATH}`);
  console.log(`[mis-upload-server]   GET /api/mis-client-import/batches/:id/download`);
});
