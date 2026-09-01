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
import '@/modules/mis-email/services/bootstrap-env';
import { sendMisEmailComposeBatch } from '@/modules/mis-email/services/compose-digest';
import { createMailTransport, resolveSmtpConfig } from '@/modules/mis-email/services/send';
import { loadDigestRecipientById } from '@/modules/mis-email/services/recipients';
import type { MisEmailPreferences } from '@/modules/mis-email/services/preferences';
import { syncSapMailInbox } from '@/modules/subcontractor-stock/services/sap-inbox';
import { runTodayReconciliation } from '@/modules/subcontractor-stock/services/reconcile-runner';
import { triggerSubcontractorEmails } from '@/modules/subcontractor-stock/services/email-sender';

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
const SAP_INBOX_SYNC_PATH = '/internal/mail/subcontractor-sap-inbox/sync';
const SAP_RECONCILE_PATH = '/internal/mail/subcontractor-reconcile';
const SAP_SEND_PATH = '/internal/mail/subcontractor-send';
// Under /internal/mail* so existing Caddy handle reaches the relay (same as SAP paths).
const CALLS_HOT_SYNC_PATH = '/internal/mail/sync/calls-hot';
const SECRET = process.env.VPS_MAIL_RELAY_SECRET?.trim() ?? '';

const MAX_BODY_BYTES = Math.max(
  1_000_000,
  Number(process.env.MAIL_RELAY_MAX_BODY_BYTES ?? 60 * 1024 * 1024) || 60 * 1024 * 1024
);
const REQUEST_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.MAIL_RELAY_REQUEST_TIMEOUT_MS ?? 300_000) || 300_000
);
const HEADERS_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.MAIL_RELAY_HEADERS_TIMEOUT_MS ?? 120_000) || 120_000
);

function readJson(req: import('http').IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolveJson, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolveJson(JSON.parse(raw));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted before body complete')));
  });
}

function contentLength(req: import('http').IncomingMessage): number {
  const raw = req.headers['content-length'];
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMailAddresses(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      parts
        .map((part) => String(part ?? '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

if (!SECRET) {
  console.error('FATAL: set VPS_MAIL_RELAY_SECRET in .env.mis-email');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  req.setTimeout(REQUEST_TIMEOUT_MS);
  res.setTimeout(REQUEST_TIMEOUT_MS);

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

  const len = contentLength(req);
  if (len > MAX_BODY_BYTES) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Request body too large (${len} bytes, max ${MAX_BODY_BYTES})` }));
    return;
  }

  if (req.url === MIS_DIGEST_PREPARED_PATH && len > 0) {
    console.log(`[mail-relay] ${MIS_DIGEST_PREPARED_PATH} Content-Length=${len}`);
  }

  try {
    if (req.url === MIS_DIGEST_PREPARED_PATH) {
      const body = (await readJson(req)) as {
        to?: string | string[];
        cc?: string | string[];
        envelopeTo?: string;
        subject?: string;
        html?: string;
        text?: string;
        attachments?: Array<{
          filename?: string;
          contentBase64?: string;
          contentType?: string;
        }>;
      };

      const to = normalizeMailAddresses(body.to);
      const cc = normalizeMailAddresses(body.cc);
      const envelopeTo = body.envelopeTo?.trim() || '';
      if (to.length === 0 || !body.subject?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'to and subject are required' }));
        return;
      }

      const smtp = resolveSmtpConfig();
      const transport = createMailTransport(smtp);
      const info = await transport.sendMail({
        from: smtp.from,
        to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(envelopeTo
          ? { envelope: { from: smtp.from, to: envelopeTo } }
          : {}),
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

    if (req.url === SAP_INBOX_SYNC_PATH) {
      const result = await syncSapMailInbox();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          upserted: result.upserted,
          entries: result.entries,
        })
      );
      return;
    }

    if (req.url === SAP_RECONCILE_PATH) {
      const body = (await readJson(req)) as { mailKeys?: string[] };
      const mailKeys = Array.isArray(body.mailKeys)
        ? body.mailKeys.map((k) => String(k).trim()).filter(Boolean)
        : undefined;
      const result = await runTodayReconciliation(
        mailKeys && mailKeys.length > 0 ? { mailKeys } : {}
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          summary: result.summary,
          todayRun: result.run,
        })
      );
      return;
    }

    if (req.url === SAP_SEND_PATH) {
      const body = (await readJson(req)) as {
        recipientIds?: string[];
        force?: boolean;
      };
      const recipientIds = Array.isArray(body.recipientIds)
        ? body.recipientIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
      if (recipientIds.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'recipientIds is required' }));
        return;
      }
      const result = await triggerSubcontractorEmails({
        force: body.force ?? true,
        recipientIds,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sentCount: result.sentCount }));
      return;
    }

    if (req.url === CALLS_HOT_SYNC_PATH) {
      const body = (await readJson(req)) as { asOf?: string; mode?: 'fast' | 'thorough' };
      const asOf = typeof body.asOf === 'string' ? body.asOf.trim() : undefined;
      if (body.mode === 'fast') {
        const { runFastCallsHotSyncThroughYesterday } = await import(
          '@/lib/read-model/manual-calls-hot-sync'
        );
        const result = await runFastCallsHotSyncThroughYesterday(asOf);
        res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: result.ok, ...result }));
        return;
      }
      const { startCallsHotSyncThroughYesterday } = await import(
        '@/lib/read-model/start-calls-hot-sync'
      );
      const result = startCallsHotSyncThroughYesterday({ asOf, rootDir: root });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
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
      portalUrl?: string | null;
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
      portalUrl: body.portalUrl,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messageId: result.messageId }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Send failed';
    console.error('[mail-relay]', message);
    const status = /exceeds|too large/i.test(message) ? 413 : 502;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mail-relay] listening on 127.0.0.1:${PORT}`);
  console.log(`[mail-relay]   max body ${MAX_BODY_BYTES} bytes, timeout ${REQUEST_TIMEOUT_MS}ms`);
  console.log(`[mail-relay]   ${RESET_PATH} (password reset)`);
  console.log(`[mail-relay]   ${MIS_DIGEST_PATH} (MIS digest — compose on VPS)`);
  console.log(`[mail-relay]   ${MIS_DIGEST_PREPARED_PATH} (MIS digest — pre-built from app)`);
  console.log(`[mail-relay]   ${MIGRATION_REPORT_PATH} (migration reports)`);
  console.log(`[mail-relay]   ${SAP_INBOX_SYNC_PATH} (subcontractor SAP inbox sync)`);
  console.log(`[mail-relay]   ${SAP_RECONCILE_PATH} (subcontractor reconcile)`);
  console.log(`[mail-relay]   ${SAP_SEND_PATH} (subcontractor send)`);
  console.log(`[mail-relay]   ${CALLS_HOT_SYNC_PATH} (manual calls→hot sync through yesterday)`);
});
