import { LOCAL_UPCOUNTRY_NCODE_LABELS } from '@/lib/arcp-claims/query';
import { maxCrmWatermarks, parseCrmDate } from '@/lib/read-model/dates';
import {
  claimMonthFromDate,
  parseArcpDmYDate,
  resolveArcpBmApprovedAt,
  resolveArcpHoApprovedAt,
} from '@/lib/read-model/arcp/dates';
import type { ArcpHotRow } from '@/lib/read-model/arcp/types';

function parseAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const raw = String(value).replace(/,/g, '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isRejected(row: Record<string, unknown>): boolean {
  const breject = String(row.breject ?? '0').toLowerCase();
  const brejectho = String(row.brejectho ?? '0').toLowerCase();
  return ['1', 'true'].includes(breject) || ['1', 'true'].includes(brejectho);
}

export function isArcpEligibleRow(row: Record<string, unknown>): boolean {
  if (isRejected(row)) return false;
  const travel = String(row.ntraveltype ?? '').trim();
  if (travel && travel !== '0') return true;
  const cat = String(row.nitemcategory ?? '').trim();
  if (!cat || cat === '0') return false;
  const label = String(row.item_category_label ?? '').trim();
  return label.length > 0;
}

export function dedupeArcpRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byNcode = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = String(row.ncode ?? '').trim();
    if (!key) continue;
    const existing = byNcode.get(key);
    if (!existing) {
      byNcode.set(key, row);
      continue;
    }
    const existingTs = parseCrmDate(existing.editedon ?? existing.addedon)?.getTime() ?? 0;
    const rowTs = parseCrmDate(row.editedon ?? row.addedon)?.getTime() ?? 0;
    if (rowTs >= existingTs) byNcode.set(key, row);
  }
  return Array.from(byNcode.values());
}

export function transformCrmRowToArcpHot(row: Record<string, unknown>): ArcpHotRow | null {
  if (!isArcpEligibleRow(row)) return null;

  const ncode = Number(row.ncode);
  const nofficeid = Number(row.nofficeid);
  if (!Number.isFinite(ncode) || !Number.isFinite(nofficeid)) return null;

  const callAt = parseCrmDate(row.dcalllogdatetime) ?? parseArcpDmYDate(row.dcalllogdatetime);
  const solveAt = parseCrmDate(row.dsolveddatetime) ?? parseArcpDmYDate(row.dsolveddatetime);
  const bmApprovedAt = resolveArcpBmApprovedAt(row);
  const hoApprovedAt = resolveArcpHoApprovedAt(row);
  const approveAt = hoApprovedAt ?? bmApprovedAt ?? null;

  const localCode = String(row.nlocalupcountry ?? '').trim();
  const localLabel =
    String(row.local_upcountry_label ?? '').trim() ||
    LOCAL_UPCOUNTRY_NCODE_LABELS[localCode] ||
    localCode ||
    null;

  const isTravel =
    String(row.ntraveltype ?? '').trim() !== '' && String(row.ntraveltype ?? '').trim() !== '0';
  const isMajor = String(row.major_minor ?? '').toLowerCase() === 'major';

  return {
    ncode,
    vucnno: row.vucnno != null ? String(row.vucnno).trim() || null : null,
    call_no:
      row.call_no != null && String(row.call_no).trim() && String(row.call_no).trim() !== '0'
        ? String(row.call_no).trim()
        : null,
    calls2fault_code:
      row.calls2fault_code != null && Number.isFinite(Number(row.calls2fault_code))
        ? Number(row.calls2fault_code)
        : null,
    nofficeid,
    office_under: row.office_under != null ? Number(row.office_under) : null,
    call_at: callAt,
    solve_at: solveAt,
    bm_approved_at: bmApprovedAt,
    ho_approved_at: hoApprovedAt,
    approve_at: approveAt,
    claim_month_call: claimMonthFromDate(callAt),
    claim_month_solve: claimMonthFromDate(solveAt),
    claim_month_approve: claimMonthFromDate(approveAt),
    ncalltype: row.ncalltype != null ? String(row.ncalltype) : null,
    nitemcategory: row.nitemcategory != null ? String(row.nitemcategory) : null,
    nlocalupcountry: localCode || null,
    call_type_label: row.call_type_label != null ? String(row.call_type_label) : null,
    item_category_label:
      row.item_category_label != null ? String(row.item_category_label) : null,
    local_upcountry_label: localLabel,
    is_travel: isTravel,
    is_major: isMajor,
    rate: parseAmount(row.rate_val ?? row.ndistancerate),
    amount_payable: parseAmount(row.amount_payable_val ?? row.nchargespayable),
    branch_approved: parseAmount(
      row.branch_approved_val ?? row.nbmapprovedamt ?? row.napproval1amount
    ),
    ho_approved: parseAmount(row.ho_approved_val ?? row.nhoapprovedamt ?? row.napproval2amount),
    is_rejected: false,
    source_editedon: parseCrmDate(row.editedon ?? row.addedon),
    added_at: parseCrmDate(row.addedon),
  };
}

export function processArcpRows(rows: Record<string, unknown>[]): ArcpHotRow[] {
  const out: ArcpHotRow[] = [];
  for (const row of dedupeArcpRows(rows)) {
    const hot = transformCrmRowToArcpHot(row);
    if (hot) out.push(hot);
  }
  return out;
}

/** @deprecated Use maxCrmWatermarks from @/lib/read-model/dates */
export const maxArcpWatermarks = maxCrmWatermarks;
