import type { PoolClient } from 'pg';
import { withAppClient } from '@/lib/read-model/db';
import type { AthenaReconciliationStatus } from './types';

export type ReconciliationRunStats = {
  totalProcessed: number;
  registered: number;
  notRegistered: number;
  multipleMatches: number;
  invalidData: number;
};

/**
 * Helper to parse service order number from Athena failure messages.
 * e.g. "Call is Already Open. Service Order No. is 26H07471"
 */
export function extractServiceOrderNo(resultValue?: string | null): string | null {
  if (!resultValue) return null;
  const match = resultValue.match(/(?:Service Order No\.?\s*is|Call No\.?\s*is)\s*([A-Z0-9]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Pure evaluation function for a single Athena failed call against candidate CRM calls.
 * Supports:
 * 1. Direct Service Order No extracted from result_value text
 * 2. Direct CCLID / Client Ticket No match
 * 3. Standard 4-Way Match (Call Type + Outlet + Serial + Date + Ticket=CCLID when ticket present)
 * 4. CCLID Already Exist matched by Serial No
 */
export function evaluateAthenaCallMatch(
  failedCall: {
    clientTicketNo?: string | null;
    callType: string | null;
    outletName: string | null;
    serialNo: string | null;
    callDate: Date | null;
    isValidMatchingData: boolean;
    resultValue?: string | null;
    failureReason?: string | null;
  },
  candidateCrmCalls: Array<{
    vtrnno: string;
    vcclid?: string | null;
    callType: string | null;
    partyName: string | null;
    serial: string | null;
    loggedAt: Date;
    statusLabel?: string | null;
  }>
): {
  status: AthenaReconciliationStatus;
  matchCount: number;
  matchedVtrnno: string | null;
  matchedVtrnnos: string[];
  matchedCrmLoggedAt: Date | null;
} {
  // Check direct extracted Service Order No from result_value
  const extractedOrderNo = extractServiceOrderNo(failedCall.resultValue ?? failedCall.failureReason);
  if (extractedOrderNo) {
    const directOrderMatch = candidateCrmCalls.find(
      (c) => c.vtrnno.toUpperCase() === extractedOrderNo.toUpperCase()
    );
    if (directOrderMatch) {
      return {
        status: 'REGISTERED',
        matchCount: 1,
        matchedVtrnno: directOrderMatch.vtrnno,
        matchedVtrnnos: [directOrderMatch.vtrnno],
        matchedCrmLoggedAt: directOrderMatch.loggedAt,
      };
    }
  }

  // Check direct CCLID / Client Ticket match
  const ticketNo = failedCall.clientTicketNo?.trim();
  if (ticketNo) {
    const cclidMatches = candidateCrmCalls.filter(
      (c) => c.vcclid && c.vcclid.trim().toUpperCase() === ticketNo.toUpperCase()
    );
    if (cclidMatches.length === 1) {
      return {
        status: 'REGISTERED',
        matchCount: 1,
        matchedVtrnno: cclidMatches[0].vtrnno,
        matchedVtrnnos: [cclidMatches[0].vtrnno],
        matchedCrmLoggedAt: cclidMatches[0].loggedAt,
      };
    }
    if (cclidMatches.length > 1) {
      return {
        status: 'MULTIPLE_MATCHES',
        matchCount: cclidMatches.length,
        matchedVtrnno: cclidMatches[0].vtrnno,
        matchedVtrnnos: cclidMatches.map((c) => c.vtrnno),
        matchedCrmLoggedAt: cclidMatches[cclidMatches.length - 1].loggedAt,
      };
    }
  }

  if (!failedCall.isValidMatchingData || !failedCall.callType || !failedCall.outletName || !failedCall.serialNo || !failedCall.callDate) {
    return {
      status: 'INVALID_DATA',
      matchCount: 0,
      matchedVtrnno: null,
      matchedVtrnnos: [],
      matchedCrmLoggedAt: null,
    };
  }

  const normCallType = failedCall.callType.trim().toUpperCase();
  const normOutlet = failedCall.outletName.trim().toUpperCase();
  const normSerial = failedCall.serialNo.replace(/\s+/g, '').toUpperCase();
  const callTimestamp = failedCall.callDate.getTime();

  const normTicket = ticketNo?.toUpperCase() ?? null;

  const matchingCrmCalls = candidateCrmCalls.filter((crm) => {
    if (!crm.callType || !crm.partyName || !crm.serial) return false;
    if (normTicket) {
      const crmCclid = crm.vcclid?.trim().toUpperCase();
      if (!crmCclid || crmCclid !== normTicket) return false;
    }
    const crmType = crm.callType.trim().toUpperCase();
    const crmOutlet = crm.partyName.trim().toUpperCase();
    const crmSerial = crm.serial.replace(/\s+/g, '').toUpperCase();
    const crmTimestamp = crm.loggedAt.getTime();

    return (
      crmType === normCallType &&
      crmOutlet === normOutlet &&
      crmSerial === normSerial &&
      crmTimestamp >= callTimestamp
    );
  });

  const matchCount = matchingCrmCalls.length;
  if (matchCount === 0) {
    return {
      status: 'NOT_REGISTERED',
      matchCount: 0,
      matchedVtrnno: null,
      matchedVtrnnos: [],
      matchedCrmLoggedAt: null,
    };
  }

  if (matchCount === 1) {
    return {
      status: 'REGISTERED',
      matchCount: 1,
      matchedVtrnno: matchingCrmCalls[0].vtrnno,
      matchedVtrnnos: [matchingCrmCalls[0].vtrnno],
      matchedCrmLoggedAt: matchingCrmCalls[0].loggedAt,
    };
  }

  return {
    status: 'MULTIPLE_MATCHES',
    matchCount,
    matchedVtrnno: matchingCrmCalls[0].vtrnno,
    matchedVtrnnos: matchingCrmCalls.map((c) => c.vtrnno),
    matchedCrmLoggedAt: matchingCrmCalls[matchingCrmCalls.length - 1].loggedAt,
  };
}

/**
 * Executes high-performance set-based SQL reconciliation across all or newly updated Athena calls.
 */
export async function executeAthenaReconciliation(
  client?: PoolClient,
  opts?: { reprocessAll?: boolean; targetId?: number }
): Promise<ReconciliationRunStats> {
  const runner = async (db: PoolClient): Promise<ReconciliationRunStats> => {
    const reprocessAll = opts?.reprocessAll === true;
    const targetId = opts?.targetId ?? null;

    // First ensure INVALID_DATA rows are properly tagged
    await db.query(`
      UPDATE athena_failed_calls_normalized
      SET
        reconciliation_status = 'INVALID_DATA',
        match_count = 0,
        matched_vtrnno = NULL,
        matched_vtrnnos = NULL,
        matched_crm_logged_at = NULL,
        reconciled_at = now(),
        updated_at = now()
      WHERE is_valid_matching_data = false
        AND reconciliation_status <> 'INVALID_DATA'
        ${targetId ? `AND id = ${targetId}` : ''}
    `);

    // Match records against calls_latest_hot across:
    // 1. Direct Service Order No extracted from result_value text ("Call is Already Open. Service Order No. is X")
    // 2. Direct CCLID match (client_ticket_no === vcclid)
    // 3. Standard 4-way match (Call Type + Outlet + Serial + logged_at >= call_date + ticket=CCLID when ticket present)
    // 4. CCLID Already Exist matched by Serial No
    const matchQuery = `
      WITH candidate_matches AS (
        -- 1. Direct Service Order No from result_value text
        SELECT
          a.id,
          c.vtrnno,
          c.status_label,
          c.party_name,
          c.call_type,
          c.serial,
          c.logged_at,
          1 AS priority
        FROM athena_failed_calls_normalized a
        JOIN calls_latest_hot c
          ON c.vtrnno = TRIM(SUBSTRING(a.result_value FROM '(?i)(?:Service Order No\\.?\\s*is|Call No\\.?\\s*is)\\s*([A-Z0-9]+)'))
        WHERE a.result_value ILIKE '%Service Order No%is%' OR a.result_value ILIKE '%Call No%is%'
          ${targetId ? `AND a.id = ${targetId}` : ''}

        UNION ALL

        -- 2. Direct CCLID match (client_ticket_no === vcclid)
        SELECT
          a.id,
          c.vtrnno,
          c.status_label,
          c.party_name,
          c.call_type,
          c.serial,
          c.logged_at,
          2 AS priority
        FROM athena_failed_calls_normalized a
        JOIN calls_latest_hot c
          ON UPPER(TRIM(c.vcclid)) = UPPER(TRIM(a.client_ticket_no))
        WHERE a.client_ticket_no IS NOT NULL AND a.client_ticket_no NOT IN ('', '0')
          ${targetId ? `AND a.id = ${targetId}` : ''}

        UNION ALL

        -- 3. Standard 4-way match (Call Type + Outlet Name + Serial No + logged_at >= call_date)
        SELECT
          a.id,
          c.vtrnno,
          c.status_label,
          c.party_name,
          c.call_type,
          c.serial,
          c.logged_at,
          3 AS priority
        FROM athena_failed_calls_normalized a
        JOIN calls_latest_hot c
          ON UPPER(TRIM(c.call_type)) = UPPER(TRIM(a.call_type))
         AND UPPER(TRIM(c.party_name)) = UPPER(TRIM(a.outlet_name))
         AND UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g')) = UPPER(REGEXP_REPLACE(COALESCE(a.serial_no, ''), '\\s+', '', 'g'))
         AND c.logged_at >= a.call_date
        WHERE a.is_valid_matching_data = true
          AND (
            a.client_ticket_no IS NULL OR TRIM(a.client_ticket_no) IN ('', '0')
            OR UPPER(TRIM(c.vcclid)) = UPPER(TRIM(a.client_ticket_no))
          )
          ${targetId ? `AND a.id = ${targetId}` : ''}

        UNION ALL

        -- 4. CCLID Already Exist matched by Serial No (when CCLID rejected)
        SELECT
          a.id,
          c.vtrnno,
          c.status_label,
          c.party_name,
          c.call_type,
          c.serial,
          c.logged_at,
          4 AS priority
        FROM athena_failed_calls_normalized a
        JOIN calls_latest_hot c
          ON UPPER(REGEXP_REPLACE(COALESCE(c.serial, ''), '\\s+', '', 'g')) = UPPER(REGEXP_REPLACE(COALESCE(a.serial_no, ''), '\\s+', '', 'g'))
        WHERE (a.failure_reason ILIKE '%cclid%' OR a.result_value ILIKE '%cclid%')
          AND a.serial_no IS NOT NULL AND a.serial_no NOT IN ('', '00000000000000', '0')
          AND (
            a.client_ticket_no IS NULL OR TRIM(a.client_ticket_no) IN ('', '0')
            OR UPPER(TRIM(c.vcclid)) = UPPER(TRIM(a.client_ticket_no))
          )
          ${targetId ? `AND a.id = ${targetId}` : ''}
      ),
      deduped_matches AS (
        SELECT DISTINCT ON (id, vtrnno)
          id, vtrnno, status_label, party_name, call_type, serial, logged_at, priority
        FROM candidate_matches
        ORDER BY id, vtrnno, priority ASC
      ),
      aggregated AS (
        SELECT
          id,
          COUNT(vtrnno) AS match_count,
          (ARRAY_AGG(vtrnno ORDER BY priority ASC, logged_at DESC))[1] AS primary_vtrnno,
          ARRAY_AGG(vtrnno ORDER BY priority ASC, logged_at DESC) AS all_vtrnnos,
          (ARRAY_AGG(logged_at ORDER BY priority ASC, logged_at DESC))[1] AS primary_crm_logged_at,
          (ARRAY_AGG(status_label ORDER BY priority ASC, logged_at DESC))[1] AS primary_crm_status,
          (ARRAY_AGG(party_name ORDER BY priority ASC, logged_at DESC))[1] AS matched_crm_party_name,
          (ARRAY_AGG(call_type ORDER BY priority ASC, logged_at DESC))[1] AS matched_crm_call_type,
          (ARRAY_AGG(serial ORDER BY priority ASC, logged_at DESC))[1] AS matched_crm_serial
        FROM deduped_matches
        GROUP BY id
      )
      UPDATE athena_failed_calls_normalized a
      SET
        reconciliation_status = CASE
          WHEN a.is_valid_matching_data = false THEN 'INVALID_DATA'
          WHEN m.match_count = 1 THEN 'REGISTERED'
          WHEN m.match_count > 1 THEN 'MULTIPLE_MATCHES'
          ELSE 'NOT_REGISTERED'
        END,
        match_count = COALESCE(m.match_count, 0),
        matched_vtrnno = m.primary_vtrnno,
        matched_vtrnnos = m.all_vtrnnos,
        matched_crm_logged_at = m.primary_crm_logged_at,
        matched_crm_status = m.primary_crm_status,
        matched_crm_party_name = m.matched_crm_party_name,
        matched_crm_call_type = m.matched_crm_call_type,
        matched_crm_serial = m.matched_crm_serial,
        reconciled_at = now(),
        updated_at = now()
      FROM (
        SELECT a.id, m.match_count, m.primary_vtrnno, m.all_vtrnnos, m.primary_crm_logged_at,
               m.primary_crm_status, m.matched_crm_party_name, m.matched_crm_call_type, m.matched_crm_serial
        FROM athena_failed_calls_normalized a
        LEFT JOIN aggregated m ON a.id = m.id
        WHERE 1=1
          ${targetId ? `AND a.id = ${targetId}` : ''}
          ${!reprocessAll && !targetId ? `AND (a.reconciled_at IS NULL OR a.reconciliation_status IN ('NOT_REGISTERED', 'MULTIPLE_MATCHES', 'REGISTERED'))` : ''}
      ) m
      WHERE a.id = m.id;
    `;

    await db.query(matchQuery);

    // Aggregate summary stats of current table state
    const statsRes = await db.query<{
      total_processed: string;
      registered: string;
      not_registered: string;
      multiple_matches: string;
      invalid_data: string;
    }>(`
      SELECT
        COUNT(*)::text AS total_processed,
        COUNT(*) FILTER (WHERE reconciliation_status = 'REGISTERED')::text AS registered,
        COUNT(*) FILTER (WHERE reconciliation_status = 'NOT_REGISTERED')::text AS not_registered,
        COUNT(*) FILTER (WHERE reconciliation_status = 'MULTIPLE_MATCHES')::text AS multiple_matches,
        COUNT(*) FILTER (WHERE reconciliation_status = 'INVALID_DATA')::text AS invalid_data
      FROM athena_failed_calls_normalized
    `);

    const row = statsRes.rows[0] ?? {
      total_processed: '0',
      registered: '0',
      not_registered: '0',
      multiple_matches: '0',
      invalid_data: '0',
    };

    return {
      totalProcessed: parseInt(row.total_processed, 10) || 0,
      registered: parseInt(row.registered, 10) || 0,
      notRegistered: parseInt(row.not_registered, 10) || 0,
      multipleMatches: parseInt(row.multiple_matches, 10) || 0,
      invalidData: parseInt(row.invalid_data, 10) || 0,
    };
  };

  if (client) {
    return runner(client);
  }
  return withAppClient(runner);
}
