import { afterEach, describe, expect, it } from 'vitest';
import { resolvePgSsl } from './db';

const LOOPBACK_POOLER =
  'postgresql://postgres.ddmapuyghfeoyajxbcjh:secret@127.0.0.1:6543/postgres?pgbouncer=true';
const REMOTE_VPS_POOLER =
  'postgresql://postgres.ddmapuyghfeoyajxbcjh:secret@api.wrl-fsm.cloud:6543/postgres?pgbouncer=true';
const CLOUD_POOLER =
  'postgresql://postgres.ref:secret@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres';

describe('resolvePgSsl', () => {
  afterEach(() => {
    delete process.env.PG_SSL;
    delete process.env.PG_SSL_REJECT_UNAUTHORIZED;
  });

  it('uses plain TCP for loopback Supavisor (VPS MIS cron)', () => {
    expect(resolvePgSsl(LOOPBACK_POOLER)).toBe(false);
  });

  it('uses plain TCP for remote VPS pooler (Vercel → self-hosted Supavisor)', () => {
    expect(resolvePgSsl(REMOTE_VPS_POOLER)).toBe(false);
  });

  it('accepts TLS without hostname verify for Supabase Cloud pooler by default', () => {
    expect(resolvePgSsl(CLOUD_POOLER)).toEqual({ rejectUnauthorized: false });
  });

  it('honours PG_SSL=false override', () => {
    process.env.PG_SSL = 'false';
    expect(resolvePgSsl(REMOTE_VPS_POOLER)).toBe(false);
  });

  it('honours sslmode=require in connection string', () => {
    const url =
      'postgresql://postgres:secret@api.wrl-fsm.cloud:6543/postgres?sslmode=require';
    expect(resolvePgSsl(url)).toEqual({ rejectUnauthorized: false });
  });

  it('verifies certificates for sslmode=verify-full', () => {
    const url =
      'postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=verify-full';
    expect(resolvePgSsl(url)).toEqual({ rejectUnauthorized: true });
  });

  it('verifies certificates for sslmode=verify-ca', () => {
    const url =
      'postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=verify-ca';
    expect(resolvePgSsl(url)).toEqual({ rejectUnauthorized: true });
  });

  it('honours PG_SSL=true override', () => {
    process.env.PG_SSL = 'true';
    expect(resolvePgSsl(LOOPBACK_POOLER)).toEqual({ rejectUnauthorized: false });
  });

  it('PG_SSL_REJECT_UNAUTHORIZED forces verify on cloud pooler', () => {
    process.env.PG_SSL_REJECT_UNAUTHORIZED = 'true';
    expect(resolvePgSsl(CLOUD_POOLER)).toEqual({ rejectUnauthorized: true });
  });
});
