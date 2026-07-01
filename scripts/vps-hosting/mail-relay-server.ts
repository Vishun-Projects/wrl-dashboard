#!/usr/bin/env npx tsx
/**
 * VPS mail relay — sends via same Postfix path as MIS reports (127.0.0.1:25).
 * Vercel forgot-password calls this because GoTrue Docker cannot reach host Postfix.
 *
 *   MAIL_RELAY_PORT=8789 npx tsx scripts/vps-hosting/mail-relay-server.ts
 */
import { config } from 'dotenv';
import { createServer } from 'http';
import { resolve } from 'path';
import { sendPasswordResetEmail } from '@/lib/auth/send-password-reset-email';

const root = resolve(__dirname, '../..');
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.mis-email') });

const PORT = Number(process.env.MAIL_RELAY_PORT ?? 8789);
const PATH = '/internal/mail/send';
const SECRET = process.env.VPS_MAIL_RELAY_SECRET?.trim() ?? '';

function readJson(req: import('http').IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolveJson(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

if (!SECRET) {
  console.error('FATAL: set VPS_MAIL_RELAY_SECRET in .env.mis-email');
  process.exit(1);
}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== PATH) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const headerSecret = req.headers['x-mail-relay-secret'];
  if (headerSecret !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const body = (await readJson(req)) as {
      to?: string;
      resetLink?: string;
      recipientName?: string | null;
    };

    if (!body.to?.trim() || !body.resetLink?.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'to and resetLink are required' }));
      return;
    }

    const result = await sendPasswordResetEmail({
      to: body.to.trim(),
      resetLink: body.resetLink.trim(),
      recipientName: body.recipientName,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messageId: result.messageId }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Send failed';
    console.error('[mail-relay]', message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[mail-relay] listening on 127.0.0.1:${PORT}${PATH}`);
});
