import { parseCrmDate } from '@/lib/read-model/dates';

export function isTruthyCrmRowFlag(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** BM Call Approved date from a trhcalls row (bapproval + editedon). */
export function resolveTrhcallsBmApprovedAt(row: Record<string, unknown>): Date | null {
  if (!isTruthyCrmRowFlag(row.bapproval)) return null;
  return (
    parseCrmDate(row.editedon) ??
    parseCrmDate(row.edited_at) ??
    parseCrmDate(row.source_editedon) ??
    null
  );
}
