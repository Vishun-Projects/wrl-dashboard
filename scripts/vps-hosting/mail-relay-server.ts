#!/usr/bin/env npx tsx
/**
 * VPS mail relay — sends via same Postfix path as MIS reports (127.0.0.1:25).
 * Vercel forgot-password calls this because GoTrue Docker cannot reach host Postfix.
 *
 *   MAIL_RELAY_PORT=8789 npx tsx scripts/vps-hosting/mail-relay-server.ts
 */
import { createRequire } from 'node:module';

// tsx CLI is not Next.js — stub server-only before app imports
const require = createRequire(import.meta.url);
try {
  const serverOnlyPath = require.resolve('server-only');
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as NodeModule;
} catch {
  /* optional */
}

import { config } from 'dotenv';
import { createServer } from 'http';
import { resolve } from 'path';
import { sendPasswordResetEmail } from '@/lib/auth/send-password-reset-email';
import '@/lib/mis-email/bootstrap-env';
import { sendMisEmailComposeBatch } from '@/lib/mis-email/compose-digest';
import { createMailTransport, resolveSmtpConfig } from '@/lib/mis-email/send';
import { loadDigestRecipientById } from '@/lib/mis-email/recipients';
import type { MisEmailPreferences } from '@/lib/mis-email/preferences';

const root = resolve(__dirname, '../..');
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.mis-email') });
config({ path: resolve(root, '.env.sync-worker') });

const PORT = Number(process.env.MAIL_RELAY_PORT ?? 8789);
const RESET_PATH = '/internal/mail/send';
const MIS_DIGEST_PATH = '/internal/mail/mis-digest';
const MIS_DIGEST_PREPARED_PATH = '/internal/mail/mis-digest-prepared';
const MIGRATION_REPORT_PATH = '/internal/mail/migration-report';
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
  if (req.method !== 'POST') {
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
    if (req.url === MIS_DIGEST_PREPARED_PATH) {
      const body = (await readJson(req)) as {
        to?: string;
        subject?: string;
        html?: string;
        text?: string;
        attachments?: Array<{
          filename?: string;
          contentBase64?: string;
          contentType?: string;
        }>;
      };

      if (!body.to?.trim() || !body.subject?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'to and subject are required' }));
        return;
      }

      const smtp = resolveSmtpConfig();
      const transport = createMailTransport(smtp);
      const info = await transport.sendMail({
        from: smtp.from,
        to: body.to.trim(),
        subject: body.subject.trim(),
        text: body.text ?? '',
        html: body.html ?? body.text ?? '',
        attachments: (body.attachments ?? [])
          .filter((item) => item.filename && item.contentBase64)
          .map((item) => ({
            filename: item.filename!,
            content: Buffer.from(item.contentBase64!, 'base64'),
            contentType: item.contentType || 'application/octet-stream',
            contentDisposition: 'attachment' as const,
          })),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messageId: info.messageId }));
      return;
    }

    if (req.url === MIS_DIGEST_PATH) {
      const body = (await readJson(req)) as {
        userId?: string;
        preferences?: MisEmailPreferences;
        sendTo?: string[];
      };

      if (!body.userId?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'userId is required' }));
        return;
      }

      const recipient = await loadDigestRecipientById(body.userId.trim());
      if (!recipient) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Recipient not found' }));
        return;
      }

      const sent = await sendMisEmailComposeBatch(recipient, {
        preferences: body.preferences,
        sendTo: body.sendTo,
        displayName: recipient.name,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sent }));
      return;
    }

    if (req.url === MIGRATION_REPORT_PATH) {
      const body = (await readJson(req)) as {
        to?: string;
        subject?: string;
        text?: string;
        html?: string;
      };
      if (!body.to?.trim() || !body.subject?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'to and subject are required' }));
        return;
      }
      const smtp = resolveSmtpConfig();
      const transport = createMailTransport(smtp);
      const info = await transport.sendMail({
        from: smtp.from,
        to: body.to.trim(),
        subject: body.subject.trim(),
        text: body.text ?? '',
        html: body.html ?? body.text ?? '',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messageId: info.messageId }));
      return;
    }

    if (req.url !== RESET_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

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
  console.log(`[mail-relay] listening on 127.0.0.1:${PORT}`);
  console.log(`[mail-relay]   ${RESET_PATH} (password reset)`);
  console.log(`[mail-relay]   ${MIS_DIGEST_PATH} (MIS digest — compose on VPS)`);
  console.log(`[mail-relay]   ${MIS_DIGEST_PREPARED_PATH} (MIS digest — pre-built from app)`);
  console.log(`[mail-relay]   ${MIGRATION_REPORT_PATH} (migration reports)`);
});
