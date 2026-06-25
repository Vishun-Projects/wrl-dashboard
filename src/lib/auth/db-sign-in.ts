import 'server-only';

import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';

export type DbSignInResult = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: 'bearer';
  user: {
    id: string;
    email: string;
  };
};

import { resolveAppDatabaseUrl, resolvePgSsl } from '@/lib/read-model/db';

function getPool(): Pool {
  const connectionString = resolveAppDatabaseUrl();
  return new Pool({ connectionString, ssl: resolvePgSsl(connectionString), max: 2 });
}

/** Dev fallback when HTTPS to GoTrue is blocked (corporate firewall) but Postgres pooler works. */
export async function signInViaDatabase(
  email: string,
  password: string
): Promise<DbSignInResult | null> {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!jwtSecret) {
    return null;
  }

  const pool = getPool();
  try {
    const { rows } = await pool.query<{
      id: string;
      email: string;
      encrypted_password: string | null;
      banned_until: Date | null;
    }>(
      `SELECT id, email, encrypted_password, banned_until
       FROM auth.users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email.trim()]
    );

    const user = rows[0];
    if (!user?.encrypted_password) {
      return null;
    }
    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      throw new Error('Account is banned');
    }

    const valid = await bcrypt.compare(password, user.encrypted_password);
    if (!valid) {
      return null;
    }

    const sessionId = randomUUID();
    const refreshToken = randomBytes(32).toString('base64url');
    const instanceId = '00000000-0000-0000-0000-000000000000';
    const expiresIn = process.env.NODE_ENV === 'development' ? 7 * 24 * 3600 : 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    await pool.query(
      `INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
       VALUES ($1, $2, now(), now(), 'aal1')`,
      [sessionId, user.id]
    );

    await pool.query(
      `INSERT INTO auth.refresh_tokens
         (instance_id, token, user_id, revoked, created_at, updated_at, session_id)
       VALUES ($1, $2, $3, false, now(), now(), $4)`,
      [instanceId, refreshToken, user.id, sessionId]
    );

    const accessToken = await new SignJWT({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
      session_id: sessionId,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('supabase')
      .setAudience('authenticated')
      .setExpirationTime(expiresAt)
      .setIssuedAt()
      .sign(new TextEncoder().encode(jwtSecret));

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      expires_at: expiresAt,
      token_type: 'bearer',
      user: { id: user.id, email: user.email },
    };
  } finally {
    await pool.end();
  }
}

export function isDbSignInAvailable(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET?.trim() && process.env.DATABASE_URL?.trim());
}

export function networkBlockedHint(): string {
  return (
    'Cannot reach Supabase Auth at api.wrl-fsm.cloud (corporate firewall). ' +
    'Add SUPABASE_JWT_SECRET to .env.local (Legacy JWT Secret from VPS dashboard), restart `npm run dev`, then sign in again.'
  );
}
