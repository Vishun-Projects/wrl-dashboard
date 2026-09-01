import { withClient } from '@/lib/read-model/db';
import type {
  AthenaFailedNormalizedRow,
  AthenaReconciliationFilterParams,
  AthenaRowsResponse,
} from '@/modules/athena-reconciliation/types';
import { buildAthenaFilterSql } from '@/modules/athena-reconciliation/server/filter-sql';
import { escapeCsvCell } from '@/lib/utils/csv';

function resolveSortColumn(sortBy?: string): string {
  switch (sortBy) {
    case 'callDate':
      return 'a.call_date';
    case 'clientCaption':
      return 'a.client_caption';
    case 'branchName':
      return 'a.branch_name';
    case 'clientTicketNo':
      return 'a.client_ticket_no';
    case 'callType':
      return 'a.call_type';
    case 'outletName':
      return 'a.outlet_name';
    case 'serialNo':
      return 'a.serial_no';
    case 'model':
      return 'a.model';
    case 'reconciliationStatus':
      return 'a.reconciliation_status';
    case 'failureReason':
      return 'a.failure_reason';
    case 'matchCount':
      return 'a.match_count';
    default:
      return 'a.call_date';
  }
}

export async function fetchAthenaFailedCallsRows(
  params: AthenaReconciliationFilterParams = {}
): Promise<AthenaRowsResponse> {
  return withClient(async (client) => {
    const { whereClause, values } = buildAthenaFilterSql(params, {
      applyStatus: true,
      includeSearch: true,
    });
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(params.pageSize) || 25));
    const offset = (page - 1) * pageSize;

    const sortCol = resolveSortColumn(params.sortBy);
    const sortOrder = params.sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 1. Total Count (after dedup by ticket+reason+serial+calltype)
    const countRes = await client.query<{ total: string }>(
      `WITH deduped AS (
         SELECT DISTINCT ON (
           COALESCE(a.client_ticket_no, ''),
           COALESCE(a.failure_reason, ''),
           COALESCE(a.serial_no, ''),
           COALESCE(a.call_type, '')
         ) a.id
         FROM athena_failed_calls_normalized a
         WHERE ${whereClause}
         ORDER BY
           COALESCE(a.client_ticket_no, ''),
           COALESCE(a.failure_reason, ''),
           COALESCE(a.serial_no, ''),
           COALESCE(a.call_type, ''),
           CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
           a.id DESC
       )
       SELECT COUNT(*)::text AS total FROM deduped`,
      values
    );
    const total = parseInt(countRes.rows[0]?.total ?? '0', 10) || 0;

    // 2. Paginated Data
    const hasTreat = Boolean(
      params.treatAsRegisteredReasons && params.treatAsRegisteredReasons.length > 0
    );

    let statusExpr: string;
    let dataValues: unknown[];
    let limitPlaceholder: string;
    let offsetPlaceholder: string;

    if (hasTreat) {
      const treatIdx = values.length + 1;
      const limitIdx = values.length + 2;
      const offsetIdx = values.length + 3;
      statusExpr = `CASE WHEN EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')) THEN 'REGISTERED' ELSE a.reconciliation_status END`;
      dataValues = [...values, params.treatAsRegisteredReasons, pageSize, offset];
      limitPlaceholder = `$${limitIdx}`;
      offsetPlaceholder = `$${offsetIdx}`;
    } else {
      const limitIdx = values.length + 1;
      const offsetIdx = values.length + 2;
      statusExpr = `a.reconciliation_status`;
      dataValues = [...values, pageSize, offset];
      limitPlaceholder = `$${limitIdx}`;
      offsetPlaceholder = `$${offsetIdx}`;
    }

    const dataRes = await client.query<AthenaFailedNormalizedRow>(
      `
      SELECT
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
        ${statusExpr} AS "reconciliationStatus",
        a.match_count AS "matchCount",
        a.matched_vtrnno AS "matchedVtrnno",
        a.matched_vtrnnos AS "matchedVtrnnos",
        a.matched_crm_logged_at AS "matchedCrmLoggedAt",
        a.matched_crm_status AS "matchedCrmStatus",
        a.matched_crm_party_name AS "matchedCrmPartyName",
        a.matched_crm_call_type AS "matchedCrmCallType",
        a.matched_crm_serial AS "matchedCrmSerial",
        a.reconciled_at AS "reconciledAt",
        a.updated_at AS "updatedAt",
        a.attempt_count AS "attemptCount"
      FROM (
        SELECT
          a.*,
          COUNT(*) OVER (
            PARTITION BY
              COALESCE(a.client_ticket_no, ''),
              COALESCE(a.failure_reason, ''),
              COALESCE(a.serial_no, ''),
              COALESCE(a.call_type, '')
          )::int AS attempt_count,
          ROW_NUMBER() OVER (
            PARTITION BY
              COALESCE(a.client_ticket_no, ''),
              COALESCE(a.failure_reason, ''),
              COALESCE(a.serial_no, ''),
              COALESCE(a.call_type, '')
            ORDER BY
              CASE a.reconciliation_status WHEN 'REGISTERED' THEN 0 ELSE 1 END,
              a.id DESC
          ) AS rn
        FROM athena_failed_calls_normalized a
        WHERE ${whereClause}
      ) a
      WHERE a.rn = 1
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST, a.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      dataValues
    );

    const rows: AthenaFailedNormalizedRow[] = dataRes.rows.map((r) => ({
      id: r.id,
      rawFingerprint: r.rawFingerprint,
      clientCaption: r.clientCaption,
      branchName: r.branchName,
      clientTicketNo: r.clientTicketNo,
      mcStatus: r.mcStatus,
      callType: r.callType,
      natureOfComplaint: r.natureOfComplaint,
      outletName: r.outletName,
      outletAddress: r.outletAddress,
      pincode: r.pincode,
      phone: r.phone,
      model: r.model,
      serialNo: r.serialNo,
      assetNo: r.assetNo,
      invoiceNo: r.invoiceNo,
      productStatus: r.productStatus,
      result: r.result,
      resultValue: r.resultValue,
      failureReason: r.failureReason,
      callDate: r.callDate,
      receivedDate: r.receivedDate,
      addedonAt: r.addedonAt,
      isValidMatchingData: r.isValidMatchingData,
      invalidReason: r.invalidReason,
      reconciliationStatus: r.reconciliationStatus,
      matchCount: r.matchCount,
      matchedVtrnno: r.matchedVtrnno,
      matchedVtrnnos: r.matchedVtrnnos,
      matchedCrmLoggedAt: r.matchedCrmLoggedAt,
      matchedCrmStatus: r.matchedCrmStatus,
      matchedCrmPartyName: r.matchedCrmPartyName,
      matchedCrmCallType: r.matchedCrmCallType,
      matchedCrmSerial: r.matchedCrmSerial,
      reconciledAt: r.reconciledAt,
      updatedAt: r.updatedAt,
      attemptCount: Number((r as any).attemptCount) || 1,
    }));

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  });
}

export async function generateAthenaReconciliationCsv(
  params: AthenaReconciliationFilterParams = {}
): Promise<string> {
  return withClient(async (client) => {
    const { whereClause, values } = buildAthenaFilterSql(params, {
      applyStatus: true,
      includeSearch: true,
    });
    const sortCol = resolveSortColumn(params.sortBy);
    const sortOrder = params.sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const hasTreat = Boolean(
      params.treatAsRegisteredReasons && params.treatAsRegisteredReasons.length > 0
    );

    const csvValues = hasTreat
      ? [...values, params.treatAsRegisteredReasons]
      : values;
    const treatIdx = hasTreat ? csvValues.length : -1;
    const statusExpr =
      treatIdx > 0
        ? `CASE WHEN EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE a.failure_reason ILIKE (p || '%')) THEN 'REGISTERED' ELSE a.reconciliation_status END`
        : `a.reconciliation_status`;

    const dataRes = await client.query(
      `
      SELECT
        a.id,
        a.client_caption,
        a.branch_name,
        a.client_ticket_no,
        a.call_type,
        a.outlet_name,
        a.serial_no,
        a.call_date,
        a.received_date,
        a.failure_reason,
        ${statusExpr} AS reconciliation_status,
        a.match_count,
        a.matched_vtrnno,
        array_to_string(a.matched_vtrnnos, '; ') AS all_matched_calls,
        a.matched_crm_logged_at,
        a.matched_crm_status,
        a.reconciled_at
      FROM athena_failed_calls_normalized a
      WHERE ${whereClause}
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST, a.id DESC
      LIMIT 10000
      `,
      csvValues
    );

    const headers = [
      'ID',
      'Client',
      'Branch',
      'Ticket No',
      'Call Type',
      'Outlet Name',
      'Serial No',
      'Call Date',
      'Received Date',
      'Failure Reason',
      'Reconciliation Status',
      'Match Count',
      'Matched CRM Call No',
      'All Matched Calls',
      'CRM Logged Date',
      'CRM Status',
      'Reconciled At',
    ];

    const lines: string[] = [headers.join(',')];

    for (const row of dataRes.rows) {
      lines.push(
        [
          escapeCsvCell(row.id),
          escapeCsvCell(row.client_caption),
          escapeCsvCell(row.branch_name),
          escapeCsvCell(row.client_ticket_no),
          escapeCsvCell(row.call_type),
          escapeCsvCell(row.outlet_name),
          escapeCsvCell(row.serial_no),
          escapeCsvCell(row.call_date),
          escapeCsvCell(row.received_date),
          escapeCsvCell(row.failure_reason),
          escapeCsvCell(row.reconciliation_status),
          escapeCsvCell(row.match_count),
          escapeCsvCell(row.matched_vtrnno),
          escapeCsvCell(row.all_matched_calls),
          escapeCsvCell(row.matched_crm_logged_at),
          escapeCsvCell(row.matched_crm_status),
          escapeCsvCell(row.reconciled_at),
        ].join(',')
      );
    }

    return lines.join('\n');
  });
}
