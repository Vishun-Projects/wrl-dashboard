import { withClient } from '@/lib/read-model/db';
import type {
  AthenaCrmCallSummary,
  AthenaFailedAttemptSummary,
  AthenaFailedNormalizedRow,
  AthenaInspectionDetail,
} from './types';

const INVALID_SERIALS = new Set(['', '0', '00000000000000']);

function normalizeSerial(serial: string | null | undefined): string | null {
  if (!serial) return null;
  const norm = serial.replace(/\s+/g, '').trim().toUpperCase();
  return INVALID_SERIALS.has(norm) ? null : norm;
}

/** Union matched CRM TRNs from related Athena failure rows (deduped, sorted). */
export function collectInspectionVtrnnos(
  rows: Array<{ matchedVtrnnos?: string[] | null }>
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const trn of row.matchedVtrnnos ?? []) {
      const t = trn?.trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort();
}

const ROW_SELECT = `
  a.id,
  a.raw_fingerprint AS "rawFingerprint",
  a.client_caption AS "clientCaption",
  a.branch_name AS "branchName",
  a.client_ticket_no AS "clientTicketNo",
  a.mc_status AS "mcStatus",
  a.call_type AS "callType",
  a.nature_of_complaint AS "natureOfComplaint",
  a.outlet_name AS "outletName",
  a.outlet_address AS "outletAddress",
  a.pincode,
  a.phone,
  a.model,
  a.serial_no AS "serialNo",
  a.asset_no AS "assetNo",
  a.invoice_no AS "invoiceNo",
  a.product_status AS "productStatus",
  a.result,
  a.result_value AS "resultValue",
  a.failure_reason AS "failureReason",
  a.call_date AS "callDate",
  a.received_date AS "receivedDate",
  a.addedon_at AS "addedonAt",
  a.is_valid_matching_data AS "isValidMatchingData",
  a.invalid_reason AS "invalidReason",
  a.reconciliation_status AS "reconciliationStatus",
  a.match_count AS "matchCount",
  a.matched_vtrnno AS "matchedVtrnno",
  a.matched_vtrnnos AS "matchedVtrnnos",
  a.matched_crm_logged_at AS "matchedCrmLoggedAt",
  a.matched_crm_status AS "matchedCrmStatus",
  a.matched_crm_party_name AS "matchedCrmPartyName",
  a.matched_crm_call_type AS "matchedCrmCallType",
  a.matched_crm_serial AS "matchedCrmSerial",
  a.reconciled_at AS "reconciledAt",
  a.updated_at AS "updatedAt"
`;

function failureDedupKey(row: {
  clientTicketNo?: string | null;
  failureReason?: string | null;
  serialNo?: string | null;
  callType?: string | null;
}): string {
  return [
    row.clientTicketNo ?? '',
    row.failureReason ?? '',
    row.serialNo ?? '',
    row.callType ?? '',
  ].join('\0');
}

function isSameFailureAttempt(
  row: { id: number; clientTicketNo?: string | null; failureReason?: string | null; serialNo?: string | null; callType?: string | null },
  current: { id: number; clientTicketNo?: string | null; failureReason?: string | null; serialNo?: string | null; callType?: string | null }
): boolean {
  return row.id === current.id || failureDedupKey(row) === failureDedupKey(current);
}

function toAttemptSummary(
  row: AthenaFailedNormalizedRow,
  currentRow: AthenaFailedNormalizedRow
): AthenaFailedAttemptSummary {
  return {
    id: row.id,
    clientTicketNo: row.clientTicketNo,
    callDate: row.callDate,
    failureReason: row.failureReason,
    result: row.result,
    resultValue: row.resultValue,
    reconciliationStatus: row.reconciliationStatus,
    matchCount: row.matchCount,
    matchedVtrnnos: row.matchedVtrnnos,
    isCurrent: isSameFailureAttempt(row, currentRow),
  };
}

export async function fetchAthenaFailedCallDetail(id: number): Promise<AthenaInspectionDetail | null> {
  return withClient(async (client) => {
    const rowRes = await client.query<AthenaFailedNormalizedRow>(
      `SELECT ${ROW_SELECT} FROM athena_failed_calls_normalized a WHERE a.id = $1`,
      [id]
    );
    const row = rowRes.rows[0];
    if (!row) return null;

    const serialNorm = normalizeSerial(row.serialNo);
    let relatedRows: AthenaFailedNormalizedRow[] = [row];

    if (serialNorm) {
      const relatedRes = await client.query<AthenaFailedNormalizedRow>(
        `
        SELECT ${ROW_SELECT}
        FROM (
          SELECT DISTINCT ON (
            COALESCE(a.client_ticket_no, ''),
            COALESCE(a.failure_reason, ''),
            COALESCE(a.serial_no, ''),
            COALESCE(a.call_type, '')
          ) a.*
          FROM athena_failed_calls_normalized a
          WHERE UPPER(REGEXP_REPLACE(COALESCE(a.serial_no, ''), '\\s+', '', 'g')) = $1
          ORDER BY
            COALESCE(a.client_ticket_no, ''),
            COALESCE(a.failure_reason, ''),
            COALESCE(a.serial_no, ''),
            COALESCE(a.call_type, ''),
            CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
            a.id DESC
        ) a
        ORDER BY a.call_date ASC NULLS LAST, a.id ASC
        `,
        [serialNorm]
      );
      relatedRows = relatedRes.rows;
    }

    const relatedFailures = relatedRows.map((r) => toAttemptSummary(r, row));
    const vtrnnos = collectInspectionVtrnnos([row]);

    let crmCalls: AthenaCrmCallSummary[] = [];
    if (vtrnnos.length > 0) {
      const crmRes = await client.query<AthenaCrmCallSummary>(
        `
        SELECT
          c.vtrnno,
          c.vcclid,
          c.call_type AS "callType",
          c.party_name AS "partyName",
          c.serial,
          c.logged_at AS "loggedAt",
          c.status_label AS "statusLabel",
          c.status_bucket AS "statusBucket",
          c.complaint,
          c.branch_name AS "branchName"
        FROM calls_latest_hot c
        WHERE c.vtrnno = ANY($1::text[])
        ORDER BY c.logged_at ASC NULLS LAST, c.vtrnno ASC
        `,
        [vtrnnos]
      );
      crmCalls = crmRes.rows;
    }

    return { row, relatedFailures, crmCalls };
  });
}
