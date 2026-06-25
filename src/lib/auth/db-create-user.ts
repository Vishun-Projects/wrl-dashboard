import 'server-only';

import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { resolveAppDatabaseUrl, resolvePgSsl } from '@/lib/read-model/db';

function getPool(): Pool {
  const connectionString = resolveAppDatabaseUrl();
  return new Pool({ connectionString, ssl: resolvePgSsl(connectionString), max: 2 });
}

export type DbCreateUserResult =
  | { ok: true; id: string }
  | { ok: false; message: string; status: number };

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const pool = getPool();
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [email.trim()]
    );
    return rows[0]?.id ?? null;
  } finally {
    await pool.end();
  }
}

export async function deleteAuthUserViaDatabase(userId: string): Promise<void> {
  const pool = getPool();
  try {
    await pool.query('DELETE FROM auth.users WHERE id = $1', [userId]);
  } finally {
    await pool.end();
  }
}

/** Dev fallback when GoTrue Admin API is unreachable from localhost. */
export async function createAuthUserViaDatabase(params: {
  email: string;
  password: string;
  name: string;
}): Promise<DbCreateUserResult> {
  const email = params.email.trim();
  const name = params.name.trim();
  const pool = getPool();

  try {
    const { rows: existing } = await pool.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [email]
    );
    if (existing[0]) {
      return {
        ok: false,
        message: 'A user with this email address is already registered.',
        status: 409,
      };
    }

    const id = randomUUID();
    const hashed = await bcrypt.hash(params.password, 10);
    const instanceId = '00000000-0000-0000-0000-000000000000';

    await pool.query(
      `INSERT INTO auth.users (
         instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) VALUES ($1, $2, 'authenticated', 'authenticated', $3, $4, now(), now(), $5, $6, now(), now())`,
      [
        instanceId,
        id,
        email,
        hashed,
        JSON.stringify({ provider: 'email', providers: ['email'] }),
        JSON.stringify({ name, email_verified: true }),
      ]
    );

    return { ok: true, id };
  } finally {
    await pool.end();
  }
}
