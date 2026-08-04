import {
  LOCAL_UPCOUNTRY_NCODE_LABELS,
  type ArcpClaimsAggregateRow,
  ARCP_DATE_FILTER_OPTIONS,
  type ArcpDateFilterColumn,
} from '@/sql/arcp-claims/query';
import { buildMainBranchOptions, buildFranchiseeOptions } from '@/modules/mis';

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

export function getBranchLabel(
  selectedBranch: string[],
  appliedBranch: string[] | undefined,
  offices: any[],
  branchesList: any[]
): string {
  const branchIds = appliedBranch ?? selectedBranch;
  if (branchIds.length === 0) return 'All Branches';
  const options = buildMainBranchOptions(offices, branchesList);
  return branchIds
    .map((id) => options.find((option) => option.value === id)?.label ?? id)
    .join(', ');
}

export function getFranchiseeLabel(
  selectedFranchisee: string[],
  appliedFranchisee: string[] | undefined,
  selectedBranch: string[],
  appliedBranch: string[] | undefined,
  offices: any[],
  franchiseesList: any[]
): string {
  const franchiseeIds = appliedFranchisee ?? selectedFranchisee;
  const branchIds = appliedBranch ?? selectedBranch;
  if (franchiseeIds.length === 0) return 'All Franchisees';
  const options = buildFranchiseeOptions(offices, branchIds, franchiseesList);
  return franchiseeIds
    .map((id) => options.find((option) => option.value === id)?.label ?? id)
    .join(', ');
}

export function getCallTypeLabel(
  selectedCallTypes: string[],
  appliedCallTypes: string[] | undefined
): string {
  const callTypes = appliedCallTypes ?? selectedCallTypes;
  if (callTypes.length === 0) return 'All Call Types';
  return callTypes.join(', ');
}

export function getDateBasisLabel(
  arcpDateFilterColumn: ArcpDateFilterColumn,
  appliedDateColumn: ArcpDateFilterColumn | undefined
): string {
  const dateColumn = appliedDateColumn ?? arcpDateFilterColumn;
  return (
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateColumn)?.label ?? 'Call Date'
  );
}
