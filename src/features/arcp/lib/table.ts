import {
  LOCAL_UPCOUNTRY_NCODE_LABELS,
  type ArcpClaimsAggregateRow,
} from './query';

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
      /** One rolled-up row per service category (tally detail = category). */
      isCategoryTotal?: boolean;
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

/** How much service-line detail to show in the tally table. */
export type ArcpTallyDetailLevel = 'full' | 'category' | 'totals';

/** How service tally sections are grouped. */
export type ArcpTallyGrouping =
  | 'category'
  | 'call_type'
  | 'call_type_major_minor';

export const ARCP_TALLY_GROUPING_OPTIONS: {
  value: ArcpTallyGrouping;
  label: string;
  title: string;
}[] = [
  {
    value: 'category',
    label: 'By category',
    title: 'Call type and product category with Local/Upcountry and Major/Minor rows',
  },
  {
    value: 'call_type',
    label: 'By call type',
    title: 'One section per call type with a row per product category',
  },
  {
    value: 'call_type_major_minor',
    label: 'Call type + Major/Minor',
    title: 'One section per call type with Major and Minor totals',
  },
];

function sumTotalsFromDataRow(row: Extract<ArcpTableRow, { kind: 'data' }>): ArcpClaimsTotals {
  return {
    qty: row.qty,
    amountPayable: row.amountPayable,
    branchApproved: row.branchApproved,
    hoApproved: row.hoApproved,
  };
}

function addTotals(a: ArcpClaimsTotals, b: ArcpClaimsTotals): ArcpClaimsTotals {
  return {
    qty: a.qty + b.qty,
    amountPayable: a.amountPayable + b.amountPayable,
    branchApproved: a.branchApproved + b.branchApproved,
    hoApproved: a.hoApproved + b.hoApproved,
  };
}

/** Reduce full tally rows to category-only or totals-only views (client-side, no refetch). */
export function applyArcpTallyDetailLevel(
  model: ArcpClaimsTableModel,
  level: ArcpTallyDetailLevel
): ArcpClaimsTableModel {
  if (level === 'full') return model;

  if (level === 'totals') {
    return { rows: [], totals: model.totals };
  }

  const rows: ArcpTableRow[] = [];
  let currentHeader: string | null = null;
  let sectionTotals: ArcpClaimsTotals = {
    qty: 0,
    amountPayable: 0,
    branchApproved: 0,
    hoApproved: 0,
  };

  const flushSection = () => {
    if (!currentHeader) return;
    if (!rowHasData(sectionTotals.qty, sectionTotals.amountPayable, sectionTotals.branchApproved, sectionTotals.hoApproved)) {
      currentHeader = null;
      sectionTotals = { qty: 0, amountPayable: 0, branchApproved: 0, hoApproved: 0 };
      return;
    }
    rows.push({
      kind: 'data',
      serviceDescriptionSubLabel: currentHeader,
      rate: null,
      qty: sectionTotals.qty,
      amountPayable: sectionTotals.amountPayable,
      branchApproved: sectionTotals.branchApproved,
      hoApproved: sectionTotals.hoApproved,
      isCategoryTotal: true,
    });
    currentHeader = null;
    sectionTotals = { qty: 0, amountPayable: 0, branchApproved: 0, hoApproved: 0 };
  };

  for (const row of model.rows) {
    if (row.kind === 'section-header') {
      flushSection();
      currentHeader = row.serviceDescription;
      continue;
    }
    if (row.kind === 'data' && currentHeader) {
      sectionTotals = addTotals(sectionTotals, sumTotalsFromDataRow(row));
      continue;
    }
    if (row.kind === 'travel') {
      flushSection();
      rows.push(row);
    }
  }
  flushSection();

  return { rows, totals: model.totals };
}

export function countArcpCategorySections(model: ArcpClaimsTableModel): number {
  return model.rows.filter((r) => r.kind === 'section-header').length;
}

export type BuildArcpClaimsTableModelOptions = {
  includeTravel?: boolean;
  grouping?: ArcpTallyGrouping;
  /** Resolve numeric ncalltype codes (e.g. "35" → "BREAKDOWN"). */
  callTypeLabelsByCode?: Record<string, string>;
  /** Resolve numeric nitemcategory codes when label column is bare digits. */
  itemCategoryLabelsByCode?: Record<string, string>;
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
  callTypeCode: string;
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

export function arcpTotalsHaveData(totals: ArcpClaimsTotals): boolean {
  return rowHasData(totals.qty, totals.amountPayable, totals.branchApproved, totals.hoApproved);
}

export function arcpModelHasDisplayableContent(model: ArcpClaimsTableModel | null): boolean {
  if (!model) return false;
  if (model.rows.length > 0) return true;
  return arcpTotalsHaveData(model.totals);
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

function resolveDisplayLabel(
  label: string,
  code: string,
  lookup?: Record<string, string>
): string {
  const trimmed = label.trim();
  if (trimmed && !isBareNumericLabel(trimmed)) return trimmed;
  const fromCode = lookup?.[code.trim()];
  if (fromCode && !isBareNumericLabel(fromCode)) return fromCode;
  return trimmed || code.trim();
}

function buildSectionHeader(
  callTypeLabel: string,
  itemCategoryLabel: string,
  itemCategoryCode: string,
  lookups?: {
    callTypeLabelsByCode?: Record<string, string>;
    itemCategoryLabelsByCode?: Record<string, string>;
  }
): string | null {
  const callTypeCode = callTypeLabel.trim();
  let itemCategory = itemCategoryLabel.trim();
  const itemCode = itemCategoryCode.trim();
  if (!itemCategory || isBareNumericLabel(itemCategory)) {
    itemCategory = itemCode;
  }
  if (!itemCategory) return null;

  let callTypeDisplay = resolveDisplayLabel(
    callTypeLabel,
    callTypeCode,
    lookups?.callTypeLabelsByCode
  );
  let categoryDisplay = resolveDisplayLabel(
    itemCategoryLabel,
    itemCode,
    lookups?.itemCategoryLabelsByCode
  );

  if (isBareNumericLabel(callTypeDisplay)) {
    callTypeDisplay = callTypeCode ? `Type ${callTypeCode}` : '';
  }
  if (isBareNumericLabel(categoryDisplay)) {
    categoryDisplay = itemCode ? `Category ${itemCode}` : '';
  }
  if (!categoryDisplay) return null;
  if (!callTypeDisplay) return categoryDisplay;
  return `${callTypeDisplay} – ${categoryDisplay}`;
}

function bucketAggregates(
  rows: ArcpClaimsAggregateRow[],
  lookups?: BuildArcpClaimsTableModelOptions
) {
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

    const callTypeCode = String(row.ncalltype ?? '');
    const itemCategoryCode = String(row.nitemcategory ?? '');
    const callTypeLabel = resolveDisplayLabel(
      String(row.call_type_label || ''),
      callTypeCode,
      lookups?.callTypeLabelsByCode
    );
    const itemCategoryLabel = resolveDisplayLabel(
      String(row.item_category_label || ''),
      itemCategoryCode,
      lookups?.itemCategoryLabelsByCode
    );
    const sectionKey = `${String(row.ncalltype ?? '')}|${String(row.nitemcategory ?? '')}`;
    const { subLabel, sortKey } = buildSubRowLabel(row);

    if (!serviceBuckets.has(sectionKey)) {
      serviceBuckets.set(sectionKey, {
        callTypeCode,
        callTypeLabel,
        itemCategoryLabel,
        itemCategoryCode,
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

type RolledCell = {
  subLabel: string;
  sortKey: string;
  rate: number | null;
  qty: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

function mergeRolledCell(target: RolledCell, source: SectionCell) {
  target.qty += source.qty;
  target.amountPayable += source.amountPayable;
  target.branchApproved += source.branchApproved;
  target.hoApproved += source.hoApproved;
  if (source.rate != null) {
    target.rate =
      target.rate == null ? source.rate : (target.rate + source.rate) / 2;
  }
}

function majorMinorBucketFromSortKey(sortKey: string): 'Major' | 'Minor' | 'General' {
  const mm = sortKey.split('|')[1]?.trim();
  if (mm === 'Major') return 'Major';
  if (mm === 'Minor') return 'Minor';
  return 'General';
}

function resolveCallTypeHeader(
  callTypeLabel: string,
  callTypeCode: string,
  lookups?: BuildArcpClaimsTableModelOptions
): string | null {
  let callTypeDisplay = resolveDisplayLabel(
    callTypeLabel,
    callTypeCode,
    lookups?.callTypeLabelsByCode
  );
  if (isBareNumericLabel(callTypeDisplay)) {
    callTypeDisplay = callTypeCode ? `Type ${callTypeCode}` : '';
  }
  return callTypeDisplay || null;
}

function resolveCategorySubLabel(
  itemCategoryLabel: string,
  itemCategoryCode: string,
  lookups?: BuildArcpClaimsTableModelOptions
): string | null {
  let categoryDisplay = resolveDisplayLabel(
    itemCategoryLabel,
    itemCategoryCode,
    lookups?.itemCategoryLabelsByCode
  );
  if (isBareNumericLabel(categoryDisplay)) {
    categoryDisplay = itemCategoryCode ? `Category ${itemCategoryCode}` : '';
  }
  return categoryDisplay || null;
}

function appendDataRows(
  rows: ArcpTableRow[],
  totals: ArcpClaimsTotals,
  dataRows: Extract<ArcpTableRow, { kind: 'data' }>[]
) {
  for (const dataRow of dataRows) {
    rows.push(dataRow);
    totals.qty += dataRow.qty;
    totals.amountPayable += dataRow.amountPayable;
    totals.branchApproved += dataRow.branchApproved;
    totals.hoApproved += dataRow.hoApproved;
  }
}

function buildCallTypeGroupedRows(
  sections: ServiceSection[],
  grouping: 'call_type' | 'call_type_major_minor',
  lookups: BuildArcpClaimsTableModelOptions | undefined,
  rows: ArcpTableRow[],
  totals: ArcpClaimsTotals
) {
  const byCallType = new Map<
    string,
    {
      callTypeLabel: string;
      callTypeCode: string;
      categoryCells: Map<string, RolledCell>;
      majorMinorCells: Map<string, RolledCell>;
    }
  >();

  for (const section of sections) {
    const callTypeKey = section.callTypeCode || section.callTypeLabel;
    if (!byCallType.has(callTypeKey)) {
      byCallType.set(callTypeKey, {
        callTypeLabel: section.callTypeLabel,
        callTypeCode: section.callTypeCode,
        categoryCells: new Map(),
        majorMinorCells: new Map(),
      });
    }
    const bucket = byCallType.get(callTypeKey)!;
    if (isBareNumericLabel(bucket.callTypeLabel) && !isBareNumericLabel(section.callTypeLabel)) {
      bucket.callTypeLabel = section.callTypeLabel;
    }

    if (grouping === 'call_type') {
      const categoryKey = section.itemCategoryCode || section.itemCategoryLabel;
      const categoryLabel =
        resolveCategorySubLabel(
          section.itemCategoryLabel,
          section.itemCategoryCode,
          lookups
        ) ?? categoryKey;
      if (!bucket.categoryCells.has(categoryKey)) {
        bucket.categoryCells.set(categoryKey, {
          subLabel: categoryLabel,
          sortKey: categoryKey,
          rate: null,
          qty: 0,
          amountPayable: 0,
          branchApproved: 0,
          hoApproved: 0,
        });
      }
      const cell = bucket.categoryCells.get(categoryKey)!;
      for (const sectionCell of section.cells.values()) {
        mergeRolledCell(cell, sectionCell);
      }
      continue;
    }

    for (const sectionCell of section.cells.values()) {
      const bucketKey = majorMinorBucketFromSortKey(sectionCell.sortKey);
      if (!bucket.majorMinorCells.has(bucketKey)) {
        bucket.majorMinorCells.set(bucketKey, {
          subLabel: bucketKey,
          sortKey: bucketKey,
          rate: null,
          qty: 0,
          amountPayable: 0,
          branchApproved: 0,
          hoApproved: 0,
        });
      }
      mergeRolledCell(bucket.majorMinorCells.get(bucketKey)!, sectionCell);
    }
  }

  const sortedCallTypes = Array.from(byCallType.values()).sort((a, b) =>
    a.callTypeLabel.localeCompare(b.callTypeLabel)
  );

  for (const callTypeBucket of sortedCallTypes) {
    const header = resolveCallTypeHeader(
      callTypeBucket.callTypeLabel,
      callTypeBucket.callTypeCode,
      lookups
    );
    if (!header) continue;

    const rolledCells =
      grouping === 'call_type'
        ? Array.from(callTypeBucket.categoryCells.values())
        : Array.from(callTypeBucket.majorMinorCells.values()).sort((a, b) => {
            const order = { Major: 0, Minor: 1, General: 2 };
            return (
              (order[a.subLabel as keyof typeof order] ?? 9) -
              (order[b.subLabel as keyof typeof order] ?? 9)
            );
          });

    const dataRows = rolledCells
      .filter((cell) =>
        rowHasData(cell.qty, cell.amountPayable, cell.branchApproved, cell.hoApproved)
      )
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

    if (dataRows.length === 0) continue;

    rows.push({ kind: 'section-header', serviceDescription: header });
    appendDataRows(rows, totals, dataRows);
  }
}

export function buildArcpClaimsTableModel(
  aggregates: ArcpClaimsAggregateRow[],
  options: BuildArcpClaimsTableModelOptions = {}
): ArcpClaimsTableModel {
  const includeTravel = options.includeTravel !== false;
  const grouping = options.grouping ?? 'category';
  const { serviceBuckets, travelTotals } = bucketAggregates(aggregates, options);
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

  if (grouping === 'call_type' || grouping === 'call_type_major_minor') {
    buildCallTypeGroupedRows(sections, grouping, options, rows, totals);
  } else {
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
        section.itemCategoryCode,
        {
          callTypeLabelsByCode: options.callTypeLabelsByCode,
          itemCategoryLabelsByCode: options.itemCategoryLabelsByCode,
        }
      );
      if (!header) continue;

      rows.push({
        kind: 'section-header',
        serviceDescription: header,
      });

      appendDataRows(rows, totals, dataRows);
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

    totals.qty += travelTotals.qty;
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
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Summary bar — show 0 instead of blank so totals are visible. */
export function formatArcpAmountSummary(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatArcpRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatArcpQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return String(Math.round(value));
}
