import { withClient } from '@/lib/read-model/db';
import type {
  AthenaFailedNormalizedRow,
  AthenaReconciliationFilterParams,
  AthenaRowsResponse,
} from './types';

function toList(val?: string | string[] | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((v) => Boolean(v) && v !== 'All');
  if (val === 'All') return [];
  return [val];
}

function buildRowsWhereClause(
  params: AthenaReconciliationFilterParams,
  alias = 'a'
): { whereClause: string; values: unknown[] } {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (params.startDate) {
    conditions.push(`${alias}.call_date >= $${paramIdx++}`);
    values.push(params.startDate);
  }
  if (params.endDate) {
    conditions.push(`${alias}.call_date <= $${paramIdx++}::date + interval '1 day'`);
    values.push(params.endDate);
  }

  const branchList = toList(params.branches || params.branch);
  if (branchList.length > 0) {
    conditions.push(`${alias}.branch_name = ANY($${paramIdx++}::text[])`);
    values.push(branchList);
  }

  const clientList = toList(params.clients || params.client);
  if (clientList.length > 0) {
    conditions.push(`${alias}.client_caption = ANY($${paramIdx++}::text[])`);
    values.push(clientList);
  }

  const callTypeList = toList(params.callTypes || params.callType);
  if (callTypeList.length > 0) {
    conditions.push(`${alias}.call_type = ANY($${paramIdx++}::text[])`);
    values.push(callTypeList);
  }

  const reasonList = toList(params.failureReasons || params.failureReason);
  if (reasonList.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM unnest($${paramIdx++}::text[]) AS r
      WHERE ${alias}.failure_reason = r
         OR ${alias}.failure_reason ILIKE (r || '%')
    )`);
    values.push(reasonList);
  }

  const excludedList = toList(params.excludedReasons);
  if (excludedList.length > 0) {
    conditions.push(`(${alias}.failure_reason IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest($${paramIdx++}::text[]) AS p
      WHERE ${alias}.failure_reason ILIKE (p || '%')
    ))`);
    values.push(excludedList);
  }

  const treatList = toList(params.treatAsRegisteredReasons);
  const hasTreat = treatList.length > 0;

  if (params.status && params.status !== 'ALL') {
    if (hasTreat) {
      const treatIdx = paramIdx++;
      values.push(params.treatAsRegisteredReasons);

      if (params.status === 'REGISTERED') {
        conditions.push(`(${alias}.reconciliation_status = 'REGISTERED' OR EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')) )`);
      } else {
        const statusIdx = paramIdx++;
        values.push(params.status);
        conditions.push(`(${alias}.reconciliation_status = $${statusIdx} AND NOT EXISTS (SELECT 1 FROM unnest($${treatIdx}::text[]) AS p WHERE ${alias}.failure_reason ILIKE (p || '%')) )`);
      }
    } else {
      conditions.push(`${alias}.reconciliation_status = $${paramIdx++}`);
      values.push(params.status);
    }
  }

  if (params.search) {
    const term = `%${params.search.trim()}%`;
    conditions.push(`(
      ${alias}.serial_no ILIKE $${paramIdx}
      OR ${alias}.outlet_name ILIKE $${paramIdx}
      OR ${alias}.client_ticket_no ILIKE $${paramIdx}
      OR ${alias}.failure_reason ILIKE $${paramIdx}
      OR ${alias}.branch_name ILIKE $${paramIdx}
      OR ${alias}.client_caption ILIKE $${paramIdx}
      OR ${alias}.matched_vtrnno ILIKE $${paramIdx}
    )`);
    values.push(term);
    paramIdx++;
  }

  return {
    whereClause: conditions.join(' AND '),
    values,
  };
}

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
    const { whereClause, values } = buildRowsWhereClause(params, 'a');
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

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function generateAthenaReconciliationCsv(
  params: AthenaReconciliationFilterParams = {}
): Promise<string> {
  return withClient(async (client) => {
    const { whereClause, values } = buildRowsWhereClause(params, 'a');
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
          escapeCsvField(row.id),
          escapeCsvField(row.client_caption),
          escapeCsvField(row.branch_name),
          escapeCsvField(row.client_ticket_no),
          escapeCsvField(row.call_type),
          escapeCsvField(row.outlet_name),
          escapeCsvField(row.serial_no),
          escapeCsvField(row.call_date),
          escapeCsvField(row.received_date),
          escapeCsvField(row.failure_reason),
          escapeCsvField(row.reconciliation_status),
          escapeCsvField(row.match_count),
          escapeCsvField(row.matched_vtrnno),
          escapeCsvField(row.all_matched_calls),
          escapeCsvField(row.matched_crm_logged_at),
          escapeCsvField(row.matched_crm_status),
          escapeCsvField(row.reconciled_at),
        ].join(',')
      );
    }

    return lines.join('\n');
  });
}
