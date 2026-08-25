import { applyPincodeGeo } from '@/lib/geo/pincode-geo';
import { isPartPending } from '@/lib/summary/derive';
import {
  classifyRegisterRowStatus,
  isMajorRepairRow,
  isRegisterRowTransferred,
  type RegisterSummaryBucket,
} from '@/lib/call/status/register-row';
import { parseLatLngFromRow } from '@/lib/geo/parse-latlong';
import { enrichTrhcallBranchFranchisee } from '@/sql/trhcalls/query';
import type { HotRow, StatusBucket } from '@/lib/read-model/types';
import { parseCrmDate } from '@/lib/read-model/dates';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { isTruthyCrmRowFlag, resolveTrhcallsBmApprovedAt } from '@/sql/trhcalls/bm-approval';
import { isRealCancelReasonCode } from '@/lib/call/status/cancel';

const STATUS_LABEL_BY_BUCKET: Record<Exclude<RegisterSummaryBucket, 'transferred'>, string> = {
  openUnallocated: 'Open Unallocated',
  assigned: 'Assigned',
  techSolved: 'Tech. Solve Call',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function mapRegisterBucketToStatusBucket(
  bucket: RegisterSummaryBucket
): StatusBucket | null {
  switch (bucket) {
    case 'openUnallocated':
      return 'open_unallocated';
    case 'assigned':
      return 'assigned';
    case 'techSolved':
      return 'tech_solved';
    case 'closed':
      return 'solved';
    case 'cancelled':
      return 'cancelled';
    case 'transferred':
      return null;
    default:
      return null;
  }
}

function normalizeGeoText(value: unknown): string | null {
  const text = String(value ?? '').trim().toUpperCase();
  return text || null;
}

export function isOpenPipelineRow(row: Record<string, unknown>): boolean {
  const solved =
    row.bsolved === true ||
    row.bsolved === 1 ||
    String(row.bsolved).toLowerCase() === 'true' ||
    String(row.bsolved) === '1';
  const techSolved =
    row.bfastclose === true ||
    row.bfastclose === 1 ||
    String(row.bfastclose).toLowerCase() === 'true' ||
    String(row.bfastclose) === '1';
  const cancel = Number(row.ncancelreason ?? 0);
  return !solved && !techSolved && (cancel === 0 || Number.isNaN(cancel));
}

export function isHotEligibleRow(row: Record<string, unknown>): boolean {
  const trn = String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
  if (!trn) return false;
  // Transferred calls leave the register — never keep in hot (reconcile deletes via includeTransferred).
  if (isRegisterRowTransferred(row)) return false;

  const loggedAt = parseCrmDate(row.callsdtrndate ?? row.dtrndate);
  if (!loggedAt) return false;

  const ytdStart = new Date(`${registerHotRetentionStart()}T00:00:00`);
  if (loggedAt >= ytdStart) return true;

  // Pre-YTD: open-old pipeline, or real cancels (Cancelled At is by editedon, not call date).
  return isOpenPipelineRow(row) || isRealCancelReasonCode(row.ncancelreason);
}

export function transformCrmRowToHot(row: Record<string, unknown>): HotRow | null {
  if (isRegisterRowTransferred(row)) return null;

  const enriched = enrichTrhcallBranchFranchisee(row);
  const geo = applyPincodeGeo({
    ...enriched,
    pincode: enriched.Pincode ?? enriched.pincode,
    city: enriched.dbCity ?? enriched.city,
    state: enriched.dbState ?? enriched.state,
  });
  const parsedCoords = parseLatLngFromRow(row);
  const lat = geo.lat != null ? Number(geo.lat) : parsedCoords?.lat ?? null;
  const lng = geo.lng != null ? Number(geo.lng) : parsedCoords?.lng ?? null;

  const registerBucket = classifyRegisterRowStatus(enriched);
  const statusBucket = mapRegisterBucketToStatusBucket(registerBucket);
  if (!statusBucket) return null;

  const loggedAt = parseCrmDate(enriched.callsdtrndate ?? enriched.dtrndate);
  if (!loggedAt) return null;

  const vtrnno = String(enriched.vtrnno ?? enriched.UniqueCallNo ?? '').trim();
  if (!vtrnno) return null;

  const ncode = toBigInt(enriched.ncode ?? enriched.id);
  const nofficeid = toBigInt(enriched.nofficeid ?? enriched.officeId);
  if (!ncode || !nofficeid) return null;

  const nengineerRaw = toBigInt(enriched.nengineer) ?? 0;
  const nengineer = nengineerRaw > 0 ? nengineerRaw : null;
  const editedAt = parseCrmDate(enriched.editedon);
  const addedAt = parseCrmDate(enriched.addedon);
  const bapproval = isTruthyCrmRowFlag(enriched.bapproval);
  const bmApprovedAt = resolveTrhcallsBmApprovedAt(enriched);

  return {
    ncode,
    vtrnno,
    vcclid: String(enriched.vcclid ?? '').trim() || null,
    nofficeid,
    nengineer,
    office_under: toBigInt(enriched.office_under),
    franchisee_code: String(enriched.franchisee_code ?? '').trim() || null,
    party_name: String(enriched.PartyName ?? enriched.party_name ?? '').trim() || null,
    branch_name: String(enriched.resolved_branch_name ?? enriched.officename ?? '').trim() || null,
    franchisee_name: String(enriched.franchisee_name ?? '').trim() || null,
    pincode: String(enriched.Pincode ?? enriched.pincode ?? '').trim() || null,
    city: normalizeGeoText(geo.city),
    state: normalizeGeoText(geo.state),
    region: String(enriched.region ?? 'OTHER').trim().toUpperCase() || 'OTHER',
    account: String(enriched.account ?? 'UNCLASSIFIED').trim() || 'UNCLASSIFIED',
    item_name: String(enriched.itemname ?? enriched.item_name ?? '').trim() || null,
    serial: String(enriched.callsvserialno ?? enriched.vserialno ?? '').trim() || null,
    wco: (() => {
      const raw = String(enriched.WCO ?? enriched.wco ?? '').trim().toUpperCase();
      return raw === 'W' || raw === 'C' || raw === 'O' || raw === 'V' ? raw : null;
    })(),
    engineer_name: String(enriched.serviceman ?? enriched.technician_name ?? '').trim() || null,
    call_type: String(enriched.calltype ?? enriched.call_type ?? '').trim() || null,
    complaint: String(enriched.vcomplaint ?? '').trim() || null,
    status_label: STATUS_LABEL_BY_BUCKET[registerBucket as Exclude<RegisterSummaryBucket, 'transferred'>] ?? null,
    status_bucket: statusBucket,
    solve_remarks: String(enriched.vsolveremarks ?? '').trim() || null,
    contact_person: String(enriched.vpersoncalling ?? '').trim() || null,
    phone: String(enriched.vinsttel1 ?? enriched.phone ?? '').trim() || null,
    address: String(enriched.vinstaddress ?? enriched.address ?? '').trim() || null,
    has_visit: Number(enriched.has_visit ?? 0) === 1,
    is_major: isMajorRepairRow(enriched),
    is_part_pending: isPartPending(enriched),
    branch_headcount: Number(enriched.branch_headcount ?? 0),
    logged_at: loggedAt,
    solved_at: parseCrmDate(enriched.callsolveddate ?? enriched.dsolvedatetime),
    edited_at: editedAt,
    added_at: addedAt,
    source_editedon: editedAt ?? addedAt,
    bsolved:
      enriched.bsolved === true ||
      enriched.bsolved === 1 ||
      String(enriched.bsolved).toLowerCase() === 'true' ||
      String(enriched.bsolved) === '1'
        ? true
        : enriched.bsolved == null
          ? null
          : false,
    bapproval: enriched.bapproval == null ? null : bapproval,
    bm_approved_at: bmApprovedAt,
    arcp_bm_approved_at: null,
    bfastclose:
      enriched.bfastclose === true ||
      enriched.bfastclose === 1 ||
      String(enriched.bfastclose).toLowerCase() === 'true' ||
      String(enriched.bfastclose) === '1'
        ? true
        : enriched.bfastclose == null
          ? null
          : false,
    ncancelreason: enriched.ncancelreason != null ? Number(enriched.ncancelreason) : null,
    cancel_reason:
      statusBucket === 'cancelled' || isRealCancelReasonCode(enriched.ncancelreason)
        ? String(enriched.cancel_reason ?? '').trim() || null
        : null,
    cancelled_at:
      statusBucket === 'cancelled' || isRealCancelReasonCode(enriched.ncancelreason)
        ? (editedAt ?? addedAt ?? loggedAt)
        : null,
    lat: lat != null && !Number.isNaN(lat) ? lat : null,
    lng: lng != null && !Number.isNaN(lng) ? lng : null,
  };
}

export function dedupeCrmRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byTrn = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const trn = String(row.vtrnno ?? row.UniqueCallNo ?? row.ncode ?? '').trim();
    if (!trn) continue;
    const existing = byTrn.get(trn);
    if (!existing) {
      byTrn.set(trn, row);
      continue;
    }
    const existingEdited = parseCrmDate(existing.editedon ?? existing.addedon)?.getTime() ?? 0;
    const rowEdited = parseCrmDate(row.editedon ?? row.addedon)?.getTime() ?? 0;
    const existingCode = Number(existing.ncode ?? 0);
    const rowCode = Number(row.ncode ?? 0);
    if (rowEdited > existingEdited || (rowEdited === existingEdited && rowCode > existingCode)) {
      byTrn.set(trn, row);
    }
  }
  return Array.from(byTrn.values());
}

export function processCrmRows(rows: Record<string, unknown>[]): HotRow[] {
  const deduped = dedupeCrmRows(rows);
  const hotRows: HotRow[] = [];
  for (const row of deduped) {
    if (!isHotEligibleRow(row)) continue;
    const hot = transformCrmRowToHot(row);
    if (hot) hotRows.push(hot);
  }
  return hotRows;
}

/** Backfill / YTD load — store every transformed CRM row (date window is enforced by fetch). */
export function processCrmRowsForYtdLoad(rows: Record<string, unknown>[]): HotRow[] {
  const deduped = dedupeCrmRows(rows);
  const hotRows: HotRow[] = [];
  for (const row of deduped) {
    const hot = transformCrmRowToHot(row);
    if (hot) hotRows.push(hot);
  }
  return hotRows;
}

export function toBigInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).trim());
  if (Number.isNaN(n)) return null;
  return Math.trunc(n);
}
