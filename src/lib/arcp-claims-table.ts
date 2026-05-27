import {
  LOCAL_UPCOUNTRY_NCODE_LABELS,
  type ArcpClaimsAggregateRow,
} from '@/lib/arcp-claims-query';

export const TRAVEL_SERVICE_LABEL = 'Reimbursement of Travel Expenses';

export type ArcpTableRow =
  | { kind: 'section-header'; serviceDescription: string }
  | {
      kind: 'data';
      serviceDescriptionSubLabel: string;
      rate: number | null;
      qty: number;
      amountPayable: number;
      branchApproved: number;
      hoApproved: number;
    }
  | {
      kind: 'travel';
      serviceDescription: typeof TRAVEL_SERVICE_LABEL;
      rate: number | null;
      amountPayable: number;
      branchApproved: number;
      hoApproved: number;
    };

export type ArcpClaimsTotals = {
  qty: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

export type ArcpClaimsTableModel = {
  rows: ArcpTableRow[];
  totals: ArcpClaimsTotals;
};

export type BuildArcpClaimsTableModelOptions = {
  includeTravel?: boolean;
};

export type ArcpMonthlyBreakdownRow = {
  month: string;
  monthLabel: string;
  qty: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

export type ArcpMonthlyBreakdownModel = {
  rows: ArcpMonthlyBreakdownRow[];
  totals: ArcpClaimsTotals;
};

type SectionCell = {
  subLabel: string;
  sortKey: string;
  rate: number | null;
  qty: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

type ServiceSection = {
  callTypeLabel: string;
  itemCategoryLabel: string;
  itemCategoryCode: string;
  cells: Map<string, SectionCell>;
};

function toNumber(value: number | string | null | undefined): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isBareNumericLabel(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function rowHasData(qty: number, amountPayable: number, branchApproved: number, hoApproved: number): boolean {
  return qty > 0 || amountPayable > 0 || branchApproved > 0 || hoApproved > 0;
}

function resolveLocalUpcountryCode(code: string): 'Local' | 'Upcountry' | null {
  const trimmed = code.trim();
  return LOCAL_UPCOUNTRY_NCODE_LABELS[trimmed] ?? null;
}

function normalizeLocalUpcountry(label: string, rawCode = ''): 'Local' | 'Upcountry' | 'Other' {
  const fromCode = resolveLocalUpcountryCode(rawCode);
  if (fromCode) return fromCode;
  const fromLabel = resolveLocalUpcountryCode(label);
  if (fromLabel) return fromLabel;

  const normalized = normalizeLabel(label);
  const code = normalizeLabel(rawCode);
  if (normalized === '1' || code === '1') return 'Local';
  if (normalized === '2' || code === '2') return 'Upcountry';
  if (normalized.includes('upcountry') || normalized.includes('up country') || normalized.includes('up-country')) {
    return 'Upcountry';
  }
  if (normalized.includes('local')) return 'Local';
  return 'Other';
}

function resolveLocalDisplay(row: ArcpClaimsAggregateRow, localKind: ReturnType<typeof normalizeLocalUpcountry>): string {
  const label = String(row.local_upcountry_label ?? '').trim();
  if (label && !isBareNumericLabel(label)) return label;

  const fromCode = resolveLocalUpcountryCode(String(row.nlocalupcountry ?? ''));
  if (fromCode) return fromCode;

  if (localKind === 'Local') return 'Local';
  if (localKind === 'Upcountry') return 'Upcountry';
  return '';
}

function resolveMajorMinor(row: ArcpClaimsAggregateRow): 'Major' | 'Minor' | null {
  const value = String(row.major_minor ?? '').trim();
  if (value === 'Major') return 'Major';
  if (value === 'Minor') return 'Minor';
  return null;
}

function buildSubRowLabel(row: ArcpClaimsAggregateRow): { subLabel: string; sortKey: string } {
  const localKind = normalizeLocalUpcountry(
    row.local_upcountry_label || row.nlocalupcountry,
    row.nlocalupcountry
  );
  const localDisplay = resolveLocalDisplay(row, localKind);
  const majorMinor = resolveMajorMinor(row);

  let subLabel = localDisplay;
  if (localDisplay && majorMinor) {
    subLabel = `${localDisplay} - ${majorMinor}`;
  } else if (majorMinor) {
    subLabel = majorMinor;
  } else if (!subLabel) {
    subLabel = 'General';
  }

  const sortKey = [
    String(row.nlocalupcountry ?? '').trim(),
    majorMinor ?? '',
  ].join('|');

  return { subLabel, sortKey };
}

function buildSectionHeader(
  callTypeLabel: string,
  itemCategoryLabel: string,
  itemCategoryCode: string
): string | null {
  const callType = callTypeLabel.trim();
  let itemCategory = itemCategoryLabel.trim();
  if (!itemCategory || isBareNumericLabel(itemCategory)) {
    itemCategory = itemCategoryCode.trim();
  }
  if (!itemCategory) return null;

  const callTypeDisplay =
    callType && !isBareNumericLabel(callType) ? callType : callType ? `Type ${callType}` : '';
  const categoryDisplay = isBareNumericLabel(itemCategory)
    ? `Category ${itemCategory}`
    : itemCategory;

  if (!callTypeDisplay) return categoryDisplay;
  return `${callTypeDisplay} – ${categoryDisplay}`;
}

function bucketAggregates(rows: ArcpClaimsAggregateRow[]) {
  const serviceBuckets = new Map<string, ServiceSection>();

  let travelTotals = {
    qty: 0,
    amountPayable: 0,
    branchApproved: 0,
    hoApproved: 0,
    rateSum: 0,
    rateCount: 0,
  };

  for (const row of rows) {
    const isTravel = Number(row.is_travel) === 1;
    const qty = toNumber(row.qty);
    const amountPayable = toNumber(row.amount_payable);
    const branchApproved = toNumber(row.branch_approved);
    const hoApproved = toNumber(row.ho_approved);
    const rate = row.rate == null || row.rate === '' ? null : toNumber(row.rate);

    if (!rowHasData(qty, amountPayable, branchApproved, hoApproved)) continue;

    if (isTravel) {
      travelTotals.qty += qty;
      travelTotals.amountPayable += amountPayable;
      travelTotals.branchApproved += branchApproved;
      travelTotals.hoApproved += hoApproved;
      if (rate != null) {
        travelTotals.rateSum += rate;
        travelTotals.rateCount += 1;
      }
      continue;
    }

    const callTypeLabel = String(row.call_type_label || row.ncalltype || '');
    const itemCategoryLabel = String(row.item_category_label || row.nitemcategory || '');
    const sectionKey = `${String(row.ncalltype ?? '')}|${String(row.nitemcategory ?? '')}`;
    const { subLabel, sortKey } = buildSubRowLabel(row);

    if (!serviceBuckets.has(sectionKey)) {
      serviceBuckets.set(sectionKey, {
        callTypeLabel,
        itemCategoryLabel,
        itemCategoryCode: String(row.nitemcategory ?? ''),
        cells: new Map(),
      });
    }

    const bucket = serviceBuckets.get(sectionKey)!;
    if (isBareNumericLabel(bucket.callTypeLabel) && !isBareNumericLabel(callTypeLabel)) {
      bucket.callTypeLabel = callTypeLabel;
    }
    if (isBareNumericLabel(bucket.itemCategoryLabel) && !isBareNumericLabel(itemCategoryLabel)) {
      bucket.itemCategoryLabel = itemCategoryLabel;
    }
    const existing = bucket.cells.get(sortKey);
    if (existing) {
      existing.qty += qty;
      existing.amountPayable += amountPayable;
      existing.branchApproved += branchApproved;
      existing.hoApproved += hoApproved;
      if (rate != null) {
        existing.rate = existing.rate == null ? rate : (existing.rate + rate) / 2;
      }
    } else {
      bucket.cells.set(sortKey, {
        subLabel,
        sortKey,
        rate,
        qty,
        amountPayable,
        branchApproved,
        hoApproved,
      });
    }
  }

  return { serviceBuckets, travelTotals };
}

function sortSections(a: ServiceSection, b: ServiceSection) {
  const callTypeDiff = a.callTypeLabel.localeCompare(b.callTypeLabel);
  if (callTypeDiff !== 0) return callTypeDiff;
  return a.itemCategoryLabel.localeCompare(b.itemCategoryLabel);
}

export function buildArcpClaimsTableModel(
  aggregates: ArcpClaimsAggregateRow[],
  options: BuildArcpClaimsTableModelOptions = {}
): ArcpClaimsTableModel {
  const includeTravel = options.includeTravel !== false;
  const { serviceBuckets, travelTotals } = bucketAggregates(aggregates);
  const rows: ArcpTableRow[] = [];
  const totals: ArcpClaimsTotals = {
    qty: 0,
    amountPayable: 0,
    branchApproved: 0,
    hoApproved: 0,
  };

  const sections = Array.from(serviceBuckets.values())
    .filter((section) => section.cells.size > 0)
    .sort(sortSections);

  for (const section of sections) {
    const dataRows = Array.from(section.cells.values())
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(
        (cell): Extract<ArcpTableRow, { kind: 'data' }> => ({
          kind: 'data',
          serviceDescriptionSubLabel: cell.subLabel,
          rate: cell.rate,
          qty: cell.qty,
          amountPayable: cell.amountPayable,
          branchApproved: cell.branchApproved,
          hoApproved: cell.hoApproved,
        })
      );

    const header = buildSectionHeader(
      section.callTypeLabel,
      section.itemCategoryLabel,
      section.itemCategoryCode
    );
    if (!header) continue;

    rows.push({
      kind: 'section-header',
      serviceDescription: header,
    });

    for (const dataRow of dataRows) {
      rows.push(dataRow);
      totals.qty += dataRow.qty;
      totals.amountPayable += dataRow.amountPayable;
      totals.branchApproved += dataRow.branchApproved;
      totals.hoApproved += dataRow.hoApproved;
    }
  }

  if (
    includeTravel &&
    rowHasData(travelTotals.qty, travelTotals.amountPayable, travelTotals.branchApproved, travelTotals.hoApproved)
  ) {
    const travelRate =
      travelTotals.rateCount > 0 ? travelTotals.rateSum / travelTotals.rateCount : null;
    rows.push({
      kind: 'travel',
      serviceDescription: TRAVEL_SERVICE_LABEL,
      rate: travelRate,
      amountPayable: travelTotals.amountPayable,
      branchApproved: travelTotals.branchApproved,
      hoApproved: travelTotals.hoApproved,
    });

    totals.amountPayable += travelTotals.amountPayable;
    totals.branchApproved += travelTotals.branchApproved;
    totals.hoApproved += travelTotals.hoApproved;
  }

  return { rows, totals };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatArcpMonthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return monthKey;
  return `${MONTH_LABELS[monthIndex]} ${year}`;
}

export function buildArcpClaimsMonthlyBreakdown(
  aggregates: ArcpClaimsAggregateRow[],
  options: BuildArcpClaimsTableModelOptions = {}
): ArcpMonthlyBreakdownModel {
  const includeTravel = options.includeTravel !== false;
  const buckets = new Map<
    string,
    { qty: number; amountPayable: number; branchApproved: number; hoApproved: number }
  >();

  for (const row of aggregates) {
    const isTravel = Number(row.is_travel) === 1;
    if (!includeTravel && isTravel) continue;

    const month = String(row.claim_month ?? 'unknown').trim() || 'unknown';
    const qty = toNumber(row.qty);
    const amountPayable = toNumber(row.amount_payable);
    const branchApproved = toNumber(row.branch_approved);
    const hoApproved = toNumber(row.ho_approved);

    if (qty === 0 && amountPayable === 0 && branchApproved === 0 && hoApproved === 0) continue;

    const existing = buckets.get(month) ?? {
      qty: 0,
      amountPayable: 0,
      branchApproved: 0,
      hoApproved: 0,
    };
    existing.qty += qty;
    existing.amountPayable += amountPayable;
    existing.branchApproved += branchApproved;
    existing.hoApproved += hoApproved;
    buckets.set(month, existing);
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, values]): ArcpMonthlyBreakdownRow => ({
      month,
      monthLabel: formatArcpMonthLabel(month),
      qty: values.qty,
      amountPayable: values.amountPayable,
      branchApproved: values.branchApproved,
      hoApproved: values.hoApproved,
    }));

  const totals = rows.reduce(
    (acc, row) => ({
      qty: acc.qty + row.qty,
      amountPayable: acc.amountPayable + row.amountPayable,
      branchApproved: acc.branchApproved + row.branchApproved,
      hoApproved: acc.hoApproved + row.hoApproved,
    }),
    { qty: 0, amountPayable: 0, branchApproved: 0, hoApproved: 0 }
  );

  return { rows, totals };
}

export function formatArcpAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatArcpRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatArcpQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return String(Math.round(value));
}
