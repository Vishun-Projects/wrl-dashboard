import type { RejectedCallRow } from '@/modules/rejected-calls/types';

const DDL = `
CREATE TABLE IF NOT EXISTS calls_rejected (
  ncode                bigint NOT NULL,
  nofficeid            bigint NOT NULL,
  call_no              text NOT NULL,
  call_date            timestamptz,
  serial_no            text,
  call_type            text,
  activity_done        text,
  solve_date           timestamptz,
  rejected_by_source   text NOT NULL,
  rejection_at         timestamptz,
  rejection_reason     text,
  rejected_by_name     text,
  branch_name          text,
  franchisee_name      text,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ncode, nofficeid)
);
CREATE INDEX IF NOT EXISTS idx_calls_rejected_at
  ON calls_rejected (rejection_at DESC);
ALTER TABLE calls_rejected ADD COLUMN IF NOT EXISTS branch_name text;
ALTER TABLE calls_rejected ADD COLUMN IF NOT EXISTS franchisee_name text;
INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_rejected_calls',
  'Calls rejected by HO or Branch Manager, with reject reasons from trhcalls'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_rejected_calls'
);
`;

let tableReady = false;

export async function ensureRejectedCallsTable(client: {
  query: (sql: string) => Promise<unknown>;
}): Promise<void> {
  if (tableReady) return;
  await client.query(DDL);
  tableReady = true;
}

function ts(value: string | null): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t || t.toLowerCase() === 'null') return null;
  return t;
}

export async function upsertRejectedCalls(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  rows: RejectedCallRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const cols = 14;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const row of rows) {
    const i = values.length;
    tuples.push(
      `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}::timestamptz, $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8}::timestamptz, $${i + 9}, $${i + 10}::timestamptz, $${i + 11}, $${i + 12}, $${i + 13}, $${i + 14}, now())`
    );
    values.push(
      row.ncode,
      row.nofficeid,
      row.callNo,
      ts(row.callDate),
      row.serialNo,
      row.callType,
      row.activityDone,
      ts(row.solveDate),
      row.rejectedBySource,
      ts(row.rejectionAt),
      row.rejectionReason,
      row.rejectedByName,
      row.branchName,
      row.franchiseeName
    );
    if (values.length >= cols * 80) {
      await flush(client, tuples, values);
      tuples.length = 0;
      values.length = 0;
    }
  }
  if (tuples.length) await flush(client, tuples, values);
}

async function flush(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  tuples: string[],
  values: unknown[]
): Promise<void> {
  await client.query(
    `
    INSERT INTO calls_rejected (
      ncode, nofficeid, call_no, call_date, serial_no, call_type,
      activity_done, solve_date, rejected_by_source, rejection_at,
      rejection_reason, rejected_by_name, branch_name, franchisee_name, synced_at
    )
    VALUES ${tuples.join(',\n')}
    ON CONFLICT (ncode, nofficeid) DO UPDATE SET
      call_no = EXCLUDED.call_no,
      call_date = EXCLUDED.call_date,
      serial_no = EXCLUDED.serial_no,
      call_type = EXCLUDED.call_type,
      activity_done = EXCLUDED.activity_done,
      solve_date = EXCLUDED.solve_date,
      rejected_by_source = EXCLUDED.rejected_by_source,
      rejection_at = EXCLUDED.rejection_at,
      rejection_reason = EXCLUDED.rejection_reason,
      rejected_by_name = EXCLUDED.rejected_by_name,
      branch_name = EXCLUDED.branch_name,
      franchisee_name = EXCLUDED.franchisee_name,
      synced_at = now()
    `,
    values
  );
}
