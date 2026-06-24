#!/usr/bin/env node
/**
 * Check that anon/service_role JWTs are signed with JWT_SECRET (VPS + Vercel alignment).
 * Does not print full secrets.
 *
 * Usage: node scripts/vps-hosting/verify-jwt-alignment.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jwtVerify } from 'jose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const vps = loadEnvFile(resolve(root, '.env.vps-setup'));
const local = loadEnvFile(resolve(root, '.env.local'));
const vercel = loadEnvFile(resolve(root, '.env.vercel.production'));

const secret =
  vps.JWT_SECRET?.trim() ||
  local.SUPABASE_JWT_SECRET?.trim() ||
  local.JWT_SECRET?.trim();

async function verify(label, token) {
  if (!token) return { label, ok: false, reason: 'missing' };
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: 'supabase',
    });
    const ref = typeof payload.ref === 'string' ? payload.ref : null;
    return {
      label,
      ok: true,
      role: payload.role,
      cloudRef: ref,
      warning: ref ? 'Still a Supabase Cloud-shaped JWT (ref claim). Regenerate with generate-jwt-keys.mjs.' : null,
    };
  } catch (err) {
    return {
      label,
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

const checks = [
  ['local anon', local.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ['local service_role', local.SUPABASE_SERVICE_ROLE_KEY],
  ['vps ANON_KEY', vps.ANON_KEY],
  ['vps SERVICE_ROLE_KEY', vps.SERVICE_ROLE_KEY],
  ['vercel anon', vercel.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ['vercel service_role', vercel.SUPABASE_SERVICE_ROLE_KEY],
];

const results = await Promise.all(checks.map(([label, token]) => verify(label, token?.trim())));

const allOk = results.every((r) => r.ok && !r.warning);
console.log(JSON.stringify({ jwtSecretConfigured: Boolean(secret), allAligned: allOk, results }, null, 2));
if (!allOk) {
  console.error('\nFix: node scripts/vps-hosting/generate-jwt-keys.mjs');
  console.error('Then update VPS (repair-supabase-env.sh), Vercel env, .env.local, and redeploy.');
  process.exit(1);
}
