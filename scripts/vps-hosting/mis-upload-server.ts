#!/usr/bin/env npx tsx
/**
 * Large-file MIS upload server for VPS (bypasses Vercel 4.5 MB body limit).
 * Run behind Caddy with client_max_body_size 320m.
 *
 *   MIS_UPLOAD_PORT=3099 npx tsx scripts/vps-hosting/mis-upload-server.ts
 */
import { config } from 'dotenv';
import { createServer } from 'http';
import { Readable } from 'stream';
import { resolve } from 'path';
import { handleMisClientUploadFormData } from '@/lib/mis-client-import/upload-http';
import {
  assertMisUploadAccess,
  resolveMisUploadUserId,
} from '@/lib/mis-client-import/upload-standalone-auth';

const root = resolve(__dirname, '../..');
config({ path: resolve(root, '.env.mis-upload') });
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.mis-email') });
config({ path: resolve(root, '.env.sync-worker') });

const PORT = Number(process.env.MIS_UPLOAD_PORT ?? 3099);
const PATH = '/api/mis-client-import/upload';

const ALLOWED_ORIGINS = new Set(
  (process.env.MIS_UPLOAD_CORS_ORIGINS ??
    'https://wrl-dashboard.vercel.app,http://localhost:3000')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);

function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

async function readFormData(req: import('http').IncomingMessage): Promise<FormData> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value[0] : value);
  }
  const request = new Request(`http://127.0.0.1${PATH}`, {
    method: 'POST',
    headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    // @ts-expect-error Node fetch requires duplex for streaming bodies
    duplex: 'half',
  });
  return request.formData();
}

createServer(async (req, res) => {
  const origin = req.headers.origin;
  const baseHeaders = corsHeaders(origin);

  if (req.method === 'OPTIONS' && req.url === PATH) {
    res.writeHead(204, baseHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== PATH) {
    res.writeHead(404, { ...baseHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    // Multipart body may include accessToken if a proxy stripped Authorization.
    const formData = await readFormData(req);
    if (!token) {
      const fromForm = formData.get('accessToken');
      if (typeof fromForm === 'string' && fromForm.trim()) {
        token = fromForm.trim();
      }
    }

    if (!token) {
      console.warn('[mis-upload-server] 401 — missing Bearer / accessToken');
      res.writeHead(401, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized — missing session token' }));
      return;
    }

    const userId = await resolveMisUploadUserId(token);
    if (!userId) {
      console.warn(
        '[mis-upload-server] 401 — token rejected (check SUPABASE_JWT_SECRET / SERVICE_ROLE_KEY in .env.mis-upload)'
      );
      res.writeHead(401, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized — invalid or expired session' }));
      return;
    }

    const allowed = await assertMisUploadAccess(userId);
    if (!allowed) {
      res.writeHead(403, { ...baseHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden — missing client import permission' }));
      return;
    }

    const result = await handleMisClientUploadFormData({ userId, formData });
    res.writeHead(result.status, { ...baseHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mis-upload-server] error:', err);
    res.writeHead(500, { ...baseHeaders, 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Upload failed',
        detail: message.slice(0, 500),
      })
    );
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[mis-upload-server] listening on http://127.0.0.1:${PORT}${PATH}`);
});
