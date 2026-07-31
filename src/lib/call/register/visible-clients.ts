import 'server-only';

import { withAppClient } from '@/lib/read-model/db';
import { normalizeVisibleClientNames } from '@/lib/call/register/clients';

let ensured = false;

export async function ensureCallRegisterVisibleClientsTable(): Promise<void> {
  if (ensured) return;
  await withAppClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.call_register_visible_clients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_call_register_visible_clients_name
      ON public.call_register_visible_clients (lower(btrim(client_name)));
    `);
  });
  ensured = true;
}

/** Shared allowlist everyone else sees. Empty until an editor Saves. */
export async function listVisibleCallRegisterClients(): Promise<string[]> {
  await ensureCallRegisterVisibleClientsTable();
  return withAppClient(async (client) => {
    const res = await client.query<{ client_name: string }>(
      `SELECT client_name
       FROM public.call_register_visible_clients
       ORDER BY sort_order ASC, lower(btrim(client_name)) ASC`
    );
    return res.rows.map((r) => String(r.client_name ?? '').trim()).filter(Boolean);
  });
}

/** Replace-all shared allowlist. Rejects empty after normalize. */
export async function replaceVisibleCallRegisterClients(names: string[]): Promise<string[]> {
  const clients = normalizeVisibleClientNames(names);
  if (!clients.length) {
    throw new Error('Select at least one account to save.');
  }
  await ensureCallRegisterVisibleClientsTable();
  return withAppClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM public.call_register_visible_clients`);
      for (let i = 0; i < clients.length; i++) {
        await client.query(
          `INSERT INTO public.call_register_visible_clients (client_name, sort_order, updated_at)
           VALUES ($1, $2, now())`,
          [clients[i], i]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return clients;
  });
}
