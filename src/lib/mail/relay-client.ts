import { Agent, fetch as undiciFetch } from 'undici';

export const DEFAULT_VPS_MAIL_RELAY_BASE = 'https://api.wrl-fsm.cloud';

const RELAY_HEADERS_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.VPS_MAIL_RELAY_HEADERS_TIMEOUT_MS ?? 120_000) || 120_000
);
const RELAY_BODY_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.VPS_MAIL_RELAY_BODY_TIMEOUT_MS ?? 300_000) || 300_000
);

const LOCAL_TUNNEL_BASE = 'http://127.0.0.1:8789';

export function resolveVpsMailRelaySecret(): string | undefined {
  return process.env.VPS_MAIL_RELAY_SECRET?.trim() || undefined;
}

export function resolveVpsMailRelayBaseUrl(): string {
  const explicit = process.env.VPS_MAIL_RELAY_URL?.trim();
  if (explicit) {
    if (explicit.includes('/internal/mail/')) {
      return explicit.replace(/\/internal\/mail\/[^/]+$/, '');
    }
    return explicit.replace(/\/$/, '');
  }
  return DEFAULT_VPS_MAIL_RELAY_BASE;
}

function normalizeRelayBase(url: string): string {
  if (url.includes('/internal/mail/')) {
    return url.replace(/\/internal\/mail\/[^/]+$/, '');
  }
  return url.replace(/\/$/, '');
}

function isLocalRelayHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost';
}

function shouldAllowInsecureRelayTls(url: string): boolean {
  if (process.env.VPS_MAIL_RELAY_INSECURE_TLS === 'true') return true;
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'api.wrl-fsm.cloud' || isLocalRelayHost(host);
  } catch {
    return false;
  }
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Build ordered relay URLs for a given path (e.g. /internal/mail/mis-digest-prepared). */
export function resolveRelayTryUrls(relayPath: string): string[] {
  const path = relayPath.startsWith('/') ? relayPath : `/${relayPath}`;
  const productionBase = DEFAULT_VPS_MAIL_RELAY_BASE;
  const explicitBase = process.env.VPS_MAIL_RELAY_URL?.trim()
    ? normalizeRelayBase(process.env.VPS_MAIL_RELAY_URL.trim())
    : null;
  const devBase = process.env.VPS_MAIL_RELAY_DEV_URL?.trim()
    ? normalizeRelayBase(process.env.VPS_MAIL_RELAY_DEV_URL.trim())
    : null;
  const tunnelEnabled = process.env.VPS_MAIL_RELAY_TUNNEL === 'true';
  const tunnelUrl = `${LOCAL_TUNNEL_BASE}${path}`;
  const productionUrl = `${productionBase}${path}`;
  const explicitUrl = explicitBase ? `${explicitBase}${path}` : null;
  const devUrl = devBase ? `${devBase}${path}` : null;

  if (process.env.NODE_ENV === 'development') {
    const candidates: string[] = [];
    if (devUrl) candidates.push(devUrl);
    if (tunnelEnabled) candidates.push(tunnelUrl);
    if (explicitUrl && !candidates.includes(explicitUrl)) candidates.push(explicitUrl);
    if (!candidates.includes(productionUrl)) candidates.push(productionUrl);
    return uniqueUrls(candidates);
  }

  if (explicitUrl) return [explicitUrl];
  return [productionUrl];
}

function isCorporateProxyBlock(status: number, bodyText: string): boolean {
  if (status !== 403) return false;
  const lower = bodyText.toLowerCase();
  return (
    lower.includes('blocked site') ||
    lower.includes('<!doctype html') ||
    (lower.includes('<html') && lower.includes('blocked'))
  );
}

/** Transient upstream/proxy failures — retry before giving up or trying the next URL. */
export function isTransientRelayStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export function resolveRelayRetryCount(): number {
  const n = Number(process.env.VPS_MAIL_RELAY_RETRIES ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 6) : 3;
}

export function resolveRelayRetryDelayMs(): number {
  const n = Number(process.env.VPS_MAIL_RELAY_RETRY_DELAY_MS ?? 400);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RelayPostResult<T> = {
  ok: true;
  status: number;
  data: T;
  url: string;
};

export type RelayPostError = {
  ok: false;
  status: number;
  error: string;
  url: string;
  isProxyBlock: boolean;
};

async function relayFetchOnce(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
): Promise<Response> {
  const useInsecureTls = shouldAllowInsecureRelayTls(url);
  if (useInsecureTls) {
    const agent = new Agent({
      connect: { rejectUnauthorized: false },
      headersTimeout: RELAY_HEADERS_TIMEOUT_MS,
      bodyTimeout: RELAY_BODY_TIMEOUT_MS,
    });
    return undiciFetch(url, {
      ...init,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }

  const agent = new Agent({
    headersTimeout: RELAY_HEADERS_TIMEOUT_MS,
    bodyTimeout: RELAY_BODY_TIMEOUT_MS,
  });
  return undiciFetch(url, {
    ...init,
    dispatcher: agent,
  } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
}

/** POST JSON to mail relay; retries transient 5xx, then tries each URL in order. */
export async function relayPostJson<T extends Record<string, unknown>>(
  relayPath: string,
  body: unknown,
  secret: string,
  opts?: {
    fetchImpl?: typeof relayFetchOnce;
    retries?: number;
    retryDelayMs?: number;
    sleepImpl?: (ms: number) => Promise<void>;
  }
): Promise<RelayPostResult<T>> {
  const urls = resolveRelayTryUrls(relayPath);
  const payload = JSON.stringify(body);
  const retries = opts?.retries ?? resolveRelayRetryCount();
  const retryDelayMs = opts?.retryDelayMs ?? resolveRelayRetryDelayMs();
  const fetchImpl = opts?.fetchImpl ?? relayFetchOnce;
  const sleepImpl = opts?.sleepImpl ?? sleep;
  let lastError: RelayPostError | null = null;

  for (const url of urls) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Mail-Relay-Secret': secret,
          },
          body: payload,
        });

        const text = await res.text();
        let data = {} as T;
        if (text.trim()) {
          try {
            data = JSON.parse(text) as T;
          } catch {
            data = { error: text.slice(0, 500) } as unknown as T;
          }
        }

        if (!res.ok) {
          const proxyBlock = isCorporateProxyBlock(res.status, text);
          const errMsg =
            (data as { error?: string }).error ||
            (proxyBlock
              ? 'Corporate network blocked api.wrl-fsm.cloud — run `npm run mail-relay:tunnel` and set VPS_MAIL_RELAY_TUNNEL=true'
              : `Mail relay failed (${res.status})`);
          lastError = {
            ok: false,
            status: res.status,
            error: errMsg,
            url,
            isProxyBlock: proxyBlock,
          };

          const transient = isTransientRelayStatus(res.status);
          if (transient && attempt < retries) {
            console.warn(
              `[mis-email/relay] ${url} failed (${res.status}) attempt ${attempt}/${retries}, retrying`
            );
            await sleepImpl(retryDelayMs * attempt);
            continue;
          }

          if (url !== urls[urls.length - 1]) {
            console.warn(`[mis-email/relay] ${url} failed (${res.status}), trying next`);
          }
          break;
        }

        return { ok: true, status: res.status, data, url };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = {
          ok: false,
          status: 0,
          error: message,
          url,
          isProxyBlock: false,
        };
        if (attempt < retries) {
          console.warn(
            `[mis-email/relay] ${url} error attempt ${attempt}/${retries}, retrying:`,
            message
          );
          await sleepImpl(retryDelayMs * attempt);
          continue;
        }
        if (url !== urls[urls.length - 1]) {
          console.warn(`[mis-email/relay] ${url} failed, trying next:`, message);
        }
        break;
      }
    }
  }

  throw new Error(formatRelayFailure(lastError, urls));
}

export function formatRelayFailure(
  lastError: RelayPostError | null,
  triedUrls: string[]
): string {
  const tried = triedUrls.join(' → ');
  const message = lastError?.error ?? 'Unknown relay error';

  if (lastError?.isProxyBlock) {
    return (
      `Mail relay blocked by your network (403). ` +
      `Run \`npm run mail-relay:tunnel\` in a separate terminal, set VPS_MAIL_RELAY_TUNNEL=true ` +
      `and VPS_MAIL_RELAY_URL=http://127.0.0.1:8789 in .env.local. Tried: ${tried}`
    );
  }

  if (/message file too big|552 5\.3\.4/i.test(message)) {
    return (
      `Email attachment is too large for the mail server (Postfix limit). ` +
      `Try a shorter date range, turn off the detailed register attachment, or ask ops to raise message_size_limit on the VPS. ` +
      `Underlying error: ${message}`
    );
  }

  if (lastError?.status === 401) {
    return (
      `Mail relay rejected the request (401 Unauthorized). ` +
      `Check VPS_MAIL_RELAY_SECRET matches VPS .env.mis-email ` +
      `(install root is usually /opt/wrl/database/fast-close-app). ` +
      `Underlying error: ${message}`
    );
  }

  if (lastError?.status === 403) {
    return (
      `Mail relay rejected the request (403). ` +
      `If on local dev, use SSH tunnel (npm run mail-relay:tunnel). ` +
      `On production, verify VPS_MAIL_RELAY_SECRET on Vercel. Tried: ${tried}. ` +
      `Underlying error: ${message}`
    );
  }

  if (isTransientRelayStatus(lastError?.status ?? 0)) {
    return (
      `Mail relay was temporarily unavailable (${lastError?.status}). ` +
      `The VPS wrl-mail-relay service may be restarting — retry in a minute. ` +
      `Tried: ${tried}. Underlying error: ${message}`
    );
  }

  return (
    `Mail relay could not deliver (tried: ${tried}). ` +
    `The report was built but SMTP never ran. Underlying error: ${message}`
  );
}
