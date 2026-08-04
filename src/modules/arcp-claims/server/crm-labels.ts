import { postQuery } from '@/lib/db/proxy';
import { withAppClient } from '@/lib/read-model/db';
import { readArcpFromPostgres } from '@/lib/read-model/flags';
import {
  isBareNumericArcpLabel,
  resolveArcpItemCategoryDisplay,
} from '@/modules/arcp-claims/services/labels';
import {
  LOCAL_UPCOUNTRY_NCODE_LABELS,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
} from '@/sql/arcp-claims/query';

export type ArcpCrmLabelLookups = {
  callTypeLabelsByCode: Record<string, string>;
  itemCategoryLabelsByCode: Record<string, string>;
};

function resolveLabel(
  label: string,
  code: string,
  lookup?: Record<string, string>
): string {
  const trimmed = label.trim();
  if (trimmed && !isBareNumericArcpLabel(trimmed)) return trimmed;
  const fromCode = lookup?.[code.trim()];
  if (fromCode && !isBareNumericArcpLabel(fromCode)) return fromCode;
  return trimmed || code.trim();
}

async function loadItemCategoryLabelsFromPostgres(): Promise<Record<string, string>> {
  return withAppClient(async (client) => {
    const result = await client.query(`
      SELECT DISTINCT
        TRIM(nitemcategory::text) AS code,
        TRIM(item_category_label) AS item_category_label
      FROM arcp_lines_hot
      WHERE item_category_label IS NOT NULL
        AND TRIM(item_category_label) <> ''
        AND nitemcategory IS NOT NULL
    `);
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      const code = String(row.code ?? '').trim();
      const label = String(row.item_category_label ?? '').trim();
      if (!code || !label || isBareNumericArcpLabel(label)) continue;
      if (!map[code] || label.length > map[code].length) map[code] = label;
    }
    return map;
  });
}

async function loadItemCategoryLabelsFromCrm(): Promise<Record<string, string>> {
  const sql = `
SELECT
  CAST(ic.ncode AS VARCHAR(50)) AS code,
  COALESCE(
    NULLIF(LTRIM(RTRIM(ic.vname)), ''),
    NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
  ) AS item_category_label
FROM mstitemcategory ic (NOLOCK)
WHERE ic.ncode IS NOT NULL
  AND LTRIM(RTRIM(CAST(ic.ncode AS VARCHAR(50)))) <> ''
  AND LTRIM(RTRIM(CAST(ic.ncode AS VARCHAR(50)))) <> '0'`;

  const res = await postQuery({ rawSql: sql, timeoutMs: 60_000 });
  const map: Record<string, string> = {};
  for (const row of res.data ?? []) {
    const code = String(row.code ?? '').trim();
    const label = String(row.item_category_label ?? '').trim();
    if (!code || !label || isBareNumericArcpLabel(label)) continue;
    if (!map[code] || label.length > map[code].length) map[code] = label;
  }
  return map;
}

export async function loadArcpCrmLabelLookups(): Promise<ArcpCrmLabelLookups> {
  const itemCategoryLoader = readArcpFromPostgres()
    ? loadItemCategoryLabelsFromPostgres()
    : loadItemCategoryLabelsFromCrm();

  const [callTypeLabelsByCode, itemCategoryLabelsByCode] = await Promise.all([
    withAppClient(async (client) => {
      const callTypes = await client.query(`
        SELECT ncode::text AS code, display_value
        FROM dim_call_types
        WHERE display_value IS NOT NULL AND TRIM(display_value) <> ''
      `);
      const map: Record<string, string> = {};
      for (const row of callTypes.rows) {
        const code = String(row.code ?? '').trim();
        const label = String(row.display_value ?? '').trim();
        if (code && label) map[code] = label;
      }
      return map;
    }),
    itemCategoryLoader,
  ]);

  return { callTypeLabelsByCode, itemCategoryLabelsByCode };
}

export function enrichArcpAggregateLabels(
  rows: ArcpClaimsAggregateRow[],
  lookups: ArcpCrmLabelLookups
): ArcpClaimsAggregateRow[] {
  return rows.map((row) => {
    const callCode = String(row.ncalltype ?? '').trim();
    const itemCode = String(row.nitemcategory ?? '').trim();
    const localCode = String(row.nlocalupcountry ?? '').trim();

    return {
      ...row,
      call_type_label: resolveLabel(
        String(row.call_type_label ?? ''),
        callCode,
        lookups.callTypeLabelsByCode
      ),
      item_category_label: resolveLabel(
        String(row.item_category_label ?? ''),
        itemCode,
        lookups.itemCategoryLabelsByCode
      ),
      local_upcountry_label:
        LOCAL_UPCOUNTRY_NCODE_LABELS[localCode] ??
        resolveLabel(String(row.local_upcountry_label ?? ''), localCode),
    };
  });
}

function buildDetailSummaryFields(row: {
  call_type: string;
  item_category: string;
  local_upcountry: string;
  major_minor: string;
  line_type: string;
}): { summary_section: string; summary_sub_row: string } {
  const isTravel = row.line_type === 'Travel';
  if (isTravel) {
    return {
      summary_section: 'Reimbursement of Travel Expenses',
      summary_sub_row: 'Reimbursement of Travel Expenses',
    };
  }

  const callType = row.call_type.trim();
  const itemCategory = row.item_category.trim();
  const local = row.local_upcountry.trim();
  const majorMinor = row.major_minor.trim();

  let summary_section = '';
  if (!itemCategory) summary_section = '';
  else if (!callType) summary_section = itemCategory;
  else summary_section = `${callType} – ${itemCategory}`;

  let summary_sub_row = 'General';
  if (local && majorMinor) summary_sub_row = `${local} - ${majorMinor}`;
  else if (local) summary_sub_row = local;
  else if (majorMinor) summary_sub_row = majorMinor;

  return { summary_section, summary_sub_row };
}

export function enrichArcpDetailRows(
  rows: ArcpClaimsDetailRow[],
  lookups: ArcpCrmLabelLookups
): ArcpClaimsDetailRow[] {
  return rows.map((row) => {
    const callCode = row.call_type.trim();
    
    const localCode = row.local_upcountry.trim();

    const call_type = resolveLabel(row.call_type, callCode, lookups.callTypeLabelsByCode);
    const item_category = resolveArcpItemCategoryDisplay(
      row.item_category,
      lookups.itemCategoryLabelsByCode
    );
    const local_upcountry =
      LOCAL_UPCOUNTRY_NCODE_LABELS[localCode] ??
      resolveLabel(row.local_upcountry, localCode);

    const summary = buildDetailSummaryFields({
      call_type,
      item_category,
      local_upcountry,
      major_minor: row.major_minor,
      line_type: row.line_type,
    });

    return {
      ...row,
      call_type,
      item_category,
      local_upcountry,
      summary_section: summary.summary_section,
      summary_sub_row: summary.summary_sub_row,
    };
  });
}
