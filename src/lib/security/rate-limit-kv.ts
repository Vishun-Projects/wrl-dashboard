import 'server-only';

import { kv } from '@vercel/kv';
import { checkRateLimit as checkRateLimitMemory } from '@/lib/security/rate-limit';

export { rateLimitClassForPath } from '@/lib/security/rate-limit-class';

const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

/** Prefer Vercel KV; fall back to memory when unset or on KV errors. */
export async function checkRateLimitKv(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!hasKv) {
    return checkRateLimitMemory(key, limit, windowMs);
  }

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const bucketKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;

  try {
    const count = await kv.incr(bucketKey);
    if (count === 1) {
      await kv.expire(bucketKey, windowSec);
    }
    if (count > limit) {
      return { allowed: false, retryAfterSec: windowSec };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    return checkRateLimitMemory(key, limit, windowMs);
  }
}
