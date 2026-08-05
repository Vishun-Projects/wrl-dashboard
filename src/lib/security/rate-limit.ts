/**
 * In-memory sliding-window rate limiter for sensitive API endpoints.
 * ponytail: Map-backed sliding window with periodic token sweep. Upgrade path: Redis rate limiter for multi-node deployments.
 */

type RateLimitRecord = {
  tokens: number[];
};

const store = new Map<string, RateLimitRecord>();
const CLEANUP_THRESHOLD = 2000;
let requestCounter = 0;

function sweepExpired(now: number) {
  for (const [key, record] of store.entries()) {
    record.tokens = record.tokens.filter((t) => t > now);
    if (record.tokens.length === 0) store.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit = 10,
  windowMs = 60_000
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  requestCounter += 1;
  if (requestCounter > CLEANUP_THRESHOLD) {
    requestCounter = 0;
    sweepExpired(now);
  }

  const record = store.get(key) || { tokens: [] };
  const cutoff = now - windowMs;
  record.tokens = record.tokens.filter((t) => t > cutoff);

  if (record.tokens.length >= limit) {
    const oldest = record.tokens[0] || now;
    const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  record.tokens.push(now);
  store.set(key, record);

  return {
    allowed: true,
    remaining: limit - record.tokens.length,
    retryAfterSec: 0,
  };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return '127.0.0.1';
}

const failureStore = new Map<string, number[]>();

export function recordFailedAttempt(key: string, windowMs = 60_000): number {
  const now = Date.now();
  const failures = failureStore.get(key) || [];
  const cutoff = now - windowMs;
  const validFailures = failures.filter((t) => t > cutoff);
  validFailures.push(now);
  failureStore.set(key, validFailures);
  return validFailures.length;
}

export function resetFailedAttempts(key: string): void {
  failureStore.delete(key);
}
