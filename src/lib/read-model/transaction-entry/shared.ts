export const TRANSACTION_ENTRY_ENTITY = 'crm_transaction_entry';

/**
 * CRM TransactionEntry — Deployment Completion only counts finished billings.
 * Matches PROCESSED = 'Y' (trim + case-insensitive).
 */
export const TRANSACTION_ENTRY_PROCESSED_SQL = `(
  UPPER(LTRIM(RTRIM(CAST(PROCESSED AS NVARCHAR(20))))) = 'Y'
)`;

/** Inclusive ~7-day windows from yyyy-mm-dd bounds (UTC). Keeps CRM + Node memory bounded. */
export function weekChunks(dateFrom: string, dateTo: string): { from: string; to: string }[] {
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const chunks: { from: string; to: string }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const from = cursor.toISOString().slice(0, 10);
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const capped = weekEnd > end ? end : weekEnd;
    const to = capped.toISOString().slice(0, 10);
    chunks.push({ from, to });
    cursor = new Date(capped);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

/** Inclusive calendar months from yyyy-mm-dd bounds (UTC). */
export function monthChunks(dateFrom: string, dateTo: string): { from: string; to: string }[] {
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const chunks: { from: string; to: string }[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();

  while (true) {
    const chunkStart = new Date(Date.UTC(y, m, 1));
    const chunkEnd = new Date(Date.UTC(y, m + 1, 0));
    const from = chunkStart < start ? dateFrom : chunkStart.toISOString().slice(0, 10);
    const to = chunkEnd > end ? dateTo : chunkEnd.toISOString().slice(0, 10);
    chunks.push({ from, to });
    if (chunkEnd >= end) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return chunks;
}

/** Inclusive calendar years from yyyy-mm-dd bounds (UTC). */
export function yearChunks(dateFrom: string, dateTo: string): { from: string; to: string }[] {
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const chunks: { from: string; to: string }[] = [];
  let y = start.getUTCFullYear();
  const endY = end.getUTCFullYear();

  while (y <= endY) {
    const chunkStart = new Date(Date.UTC(y, 0, 1));
    const chunkEnd = new Date(Date.UTC(y, 11, 31));
    const from = chunkStart < start ? dateFrom : chunkStart.toISOString().slice(0, 10);
    const to = chunkEnd > end ? dateTo : chunkEnd.toISOString().slice(0, 10);
    chunks.push({ from, to });
    y += 1;
  }
  return chunks;
}

/** Days inclusive between yyyy-mm-dd bounds (UTC). */
export function periodDays(dateFrom: string, dateTo: string): number {
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Parse CRM date (dd/mm/yyyy[ hh:mm:ss]) → Date or null. Used for daddedon + WarrantyStartDate. */
export function parseCrmDaddedon(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const s = String(raw).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  const d = new Date(`${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
