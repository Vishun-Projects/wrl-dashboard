import {
  LOCAL_UPCOUNTRY_NCODE_LABELS,
  type ArcpClaimsAggregateRow,
} from '@/lib/arcp-claims/query';

export type ArcpClientLabelLookups = {
  callTypeLabelsByCode: Record<string, string>;
  itemCategoryLabelsByCode: Record<string, string>;
};

function resolveArcpLabel(
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

/** Client-side label enrichment using lookups from /label-lookups API. */
export function enrichArcpAggregateLabelsClient(
  rows: ArcpClaimsAggregateRow[],
  lookups: ArcpClientLabelLookups
): ArcpClaimsAggregateRow[] {
  return rows.map((row) => {
    const callCode = String(row.ncalltype ?? '').trim();
    const itemCode = String(row.nitemcategory ?? '').trim();
    const localCode = String(row.nlocalupcountry ?? '').trim();

    return {
      ...row,
      call_type_label: resolveArcpLabel(
        String(row.call_type_label ?? ''),
        callCode,
        lookups.callTypeLabelsByCode
      ),
      item_category_label: resolveArcpLabel(
        String(row.item_category_label ?? ''),
        itemCode,
        lookups.itemCategoryLabelsByCode
      ),
      local_upcountry_label:
        LOCAL_UPCOUNTRY_NCODE_LABELS[localCode] ??
        resolveArcpLabel(String(row.local_upcountry_label ?? ''), localCode),
    };
  });
}

/** True when a label is only a CRM ncode (needs lookup). */
export function isBareNumericArcpLabel(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/** Display name for export/UI; resolves numeric codes via lookup when provided. */
export function resolveArcpItemCategoryDisplay(
  value: string,
  labelsByCode?: Record<string, string>
): string {
  const trimmed = value.trim();
  if (trimmed && !isBareNumericArcpLabel(trimmed)) return trimmed;
  const code = trimmed;
  const fromCode = labelsByCode?.[code];
  if (fromCode && !isBareNumericArcpLabel(fromCode)) return fromCode;
  return trimmed || code;
}
