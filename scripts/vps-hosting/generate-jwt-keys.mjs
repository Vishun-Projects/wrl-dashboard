#!/usr/bin/env node
/**
 * Generate Supabase anon + service_role JWTs from JWT_SECRET.
 * Use when SUPABASE_SERVICE_ROLE_KEY fails with "token signature is invalid".
 *
 * Usage:
 *   node scripts/vps-hosting/generate-jwt-keys.mjs
 *   JWT_SECRET='...' node scripts/vps-hosting/generate-jwt-keys.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
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
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(root, '.env.vps-setup'));
loadEnvFile(resolve(root, '.env.local'));

const secret = process.env.JWT_SECRET?.trim() || process.env.SUPABASE_JWT_SECRET?.trim();
if (!secret) {
  console.error('Set JWT_SECRET or SUPABASE_JWT_SECRET in .env.vps-setup / .env.local');
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60;
const key = new TextEncoder().encode(secret);

async function sign(role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('supabase')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

const anonKey = await sign('anon');
const serviceKey = await sign('service_role');

console.log('Generated JWT keys (signed with your JWT_SECRET). Update these everywhere:\n');
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY=' + anonKey);
console.log('SUPABASE_SERVICE_ROLE_KEY=' + serviceKey);
console.log('\nAlso set ANON_KEY and SERVICE_ROLE_KEY on the VPS when running repair-supabase-env.sh');
