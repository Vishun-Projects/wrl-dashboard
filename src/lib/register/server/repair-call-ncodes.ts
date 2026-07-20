import 'server-only';

import { postQuery } from '@/lib/db/proxy';
import {
  buildRegisterCallIdsWithRepairSql,
  resolveRegisterDateSqlColumn,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls/query';
import { parseRepairQueryParam } from '@/lib/serial-audit/repair-options';

const REPAIR_CALL_IDS_TIMEOUT_MS = 90_000;

export type RegisterRepairCallKey = { ncode: number; officeId: number };

/** Resolve Repair done → (call ncode, office) pairs. Empty array means no matching calls. */
export async function resolveRegisterRepairCallKeys(opts: {
  repair: string | null | undefined;
  startDate: string;
  endDate: string;
  dateFilterColumn?: string | RegisterDateFilterColumn | null;
  isHod: boolean;
  assignedOffices: string[];
  officeId: string;
}): Promise<RegisterRepairCallKey[] | undefined> {
  const repairNcodes = parseRepairQueryParam(opts.repair);
  if (!repairNcodes.length) return undefined;

  const sql = buildRegisterCallIdsWithRepairSql({
    repair: opts.repair || 'All',
    startDate: opts.startDate || null,
    endDate: opts.endDate || null,
    dateFilterColumn: resolveRegisterDateSqlColumn(opts.dateFilterColumn),
    isHod: opts.isHod,
    assignedOffices: opts.assignedOffices,
    officeId: opts.officeId,
  });
  if (!sql) return [];

  const res = await postQuery({ rawSql: sql, timeoutMs: REPAIR_CALL_IDS_TIMEOUT_MS });
  const byKey = new Map<string, RegisterRepairCallKey>();
  for (const row of (res.data || []) as Record<string, unknown>[]) {
    const ncode = Number(row.call_ncode);
    const officeId = Number(row.call_office_id);
    if (!Number.isFinite(ncode) || ncode <= 0) continue;
    if (!Number.isFinite(officeId) || officeId <= 0) continue;
    byKey.set(`${ncode}:${officeId}`, { ncode, officeId });
  }
  return [...byKey.values()];
}
