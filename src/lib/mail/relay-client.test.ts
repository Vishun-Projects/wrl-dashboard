import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatRelayFailure,
  isTransientRelayStatus,
  relayPostJson,
  resolveRelayTryUrls,
} from '@/lib/mail/relay-client';

const PREPARED = '/internal/mail/mis-digest-prepared';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('mail relay local vs live URL order', () => {
  const envKeys = [
    'NODE_ENV',
    'VPS_MAIL_RELAY_URL',
    'VPS_MAIL_RELAY_DEV_URL',
    'VPS_MAIL_RELAY_TUNNEL',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function stashEnv() {
    for (const key of envKeys) saved[key] = process.env[key];
  }

  it('live/production uses api.wrl-fsm.cloud by default', () => {
    stashEnv();
    process.env.NODE_ENV = 'production';
    delete process.env.VPS_MAIL_RELAY_URL;
    delete process.env.VPS_MAIL_RELAY_DEV_URL;
    delete process.env.VPS_MAIL_RELAY_TUNNEL;
    expect(resolveRelayTryUrls(PREPARED)).toEqual([
      `https://api.wrl-fsm.cloud${PREPARED}`,
    ]);
  });

  it('local development tries tunnel then live when tunnel enabled', () => {
    stashEnv();
    process.env.NODE_ENV = 'development';
    process.env.VPS_MAIL_RELAY_TUNNEL = 'true';
    delete process.env.VPS_MAIL_RELAY_URL;
    delete process.env.VPS_MAIL_RELAY_DEV_URL;
    expect(resolveRelayTryUrls(PREPARED)).toEqual([
      `http://127.0.0.1:8789${PREPARED}`,
      `https://api.wrl-fsm.cloud${PREPARED}`,
    ]);
  });

  it('local development with explicit relay URL still falls back to live', () => {
    stashEnv();
    process.env.NODE_ENV = 'development';
    process.env.VPS_MAIL_RELAY_URL = 'http://127.0.0.1:8789';
    delete process.env.VPS_MAIL_RELAY_TUNNEL;
    delete process.env.VPS_MAIL_RELAY_DEV_URL;
    expect(resolveRelayTryUrls(PREPARED)).toEqual([
      `http://127.0.0.1:8789${PREPARED}`,
      `https://api.wrl-fsm.cloud${PREPARED}`,
    ]);
  });
});

describe('mail relay transient HTTP handling', () => {
  it('treats 500/502/503/504 as transient', () => {
    expect(isTransientRelayStatus(500)).toBe(true);
    expect(isTransientRelayStatus(502)).toBe(true);
    expect(isTransientRelayStatus(503)).toBe(true);
    expect(isTransientRelayStatus(504)).toBe(true);
    expect(isTransientRelayStatus(401)).toBe(false);
    expect(isTransientRelayStatus(403)).toBe(false);
    expect(isTransientRelayStatus(400)).toBe(false);
  });

  it('retries 502 on local then succeeds on live', async () => {
    process.env.NODE_ENV = 'development';
    process.env.VPS_MAIL_RELAY_TUNNEL = 'true';
    delete process.env.VPS_MAIL_RELAY_URL;

    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('127.0.0.1:8789')) {
        return jsonResponse(502, { error: 'Bad Gateway' });
      }
      return jsonResponse(200, { ok: true, messageId: 'live-ok' });
    });

    const result = await relayPostJson<{ messageId?: string }>(
      PREPARED,
      { to: 'a@b.com', subject: 't' },
      'secret',
      {
        fetchImpl: fetchImpl as never,
        retries: 2,
        retryDelayMs: 0,
        sleepImpl: async () => undefined,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data.messageId).toBe('live-ok');
    // local retried twice, then live once
    expect(calls.filter((u) => u.includes('127.0.0.1:8789'))).toHaveLength(2);
    expect(calls.filter((u) => u.includes('api.wrl-fsm.cloud'))).toHaveLength(1);
  });

  it('does not retry forever on 401 — fails with clear secret guidance', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VPS_MAIL_RELAY_URL;

    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' }));
    await expect(
      relayPostJson(
        PREPARED,
        { to: 'a@b.com', subject: 't' },
        'wrong-secret',
        {
          fetchImpl: fetchImpl as never,
          retries: 3,
          retryDelayMs: 0,
          sleepImpl: async () => undefined,
        }
      )
    ).rejects.toThrow(/401 Unauthorized/);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('formats 502 with actionable restart guidance', () => {
    const msg = formatRelayFailure(
      {
        ok: false,
        status: 502,
        error: 'Mail relay failed (502)',
        url: 'https://api.wrl-fsm.cloud/internal/mail/mis-digest-prepared',
        isProxyBlock: false,
      },
      [
        'http://127.0.0.1:8789/internal/mail/mis-digest-prepared',
        'https://api.wrl-fsm.cloud/internal/mail/mis-digest-prepared',
      ]
    );
    expect(msg).toMatch(/temporarily unavailable \(502\)/);
    expect(msg).toMatch(/wrl-mail-relay/);
  });
});
