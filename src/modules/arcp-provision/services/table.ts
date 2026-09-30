import {
  formatArcpAmount,
  formatArcpQty,
  formatArcpRate,
  LOCAL_UPCOUNTRY_NCODE_LABELS,
} from '@/modules/arcp-claims';
import type {
  ArcpProvisionAggregateRow,
  ArcpProvisionCategoryAggregateRow,
} from '@/modules/arcp-provision/types';

export { formatArcpAmount, formatArcpQty, formatArcpRate };

export type ArcpProvisionTallyVendor = {
  branchId: string;
  branchName: string;
  franchiseeId: string;
  franchiseeName: string;
  vendorCode: string;
  qty: number;
  rateMst: number | null;
  rateCrm: number;
  variance: number | null;
  travelAmount: number;
};

export type ArcpProvisionTallyBranch = {
  branchId: string;
  branchName: string;
  vendors: ArcpProvisionTallyVendor[];
  qty: number;
  rateMst: number;
  rateCrm: number;
  variance: number;
  travelAmount: number;
};

/** @deprecated use ArcpProvisionTallyVendor */
export type ArcpProvisionTallyRow = ArcpProvisionTallyVendor;

export type ArcpProvisionTableModel = {
  branches: ArcpProvisionTallyBranch[];
  totals: {
    qty: number;
    rateMst: number;
    rateCrm: number;
    variance: number;
    travelAmount: number;
  };
};

export function buildArcpProvisionTableModel(
  aggregates: ArcpProvisionAggregateRow[]
): ArcpProvisionTableModel {
  const byBranch = new Map<string, ArcpProvisionTallyBranch>();

  for (const row of aggregates) {
    const branchId = row.branch_id || '_';
    let branch = byBranch.get(branchId);
    if (!branch) {
      branch = {
        branchId,
        branchName: row.branch_name || branchId,
        vendors: [],
        qty: 0,
        rateMst: 0,
        rateCrm: 0,
        variance: 0,
        travelAmount: 0,
      };
      byBranch.set(branchId, branch);
    }

    const vendor: ArcpProvisionTallyVendor = {
      branchId,
      branchName: branch.branchName,
      franchiseeId: row.franchisee_id,
      franchiseeName: row.franchisee_name,
      vendorCode: row.vendor_code,
      qty: row.qty,
      rateMst: row.rate_mst,
      rateCrm: row.rate_crm,
      variance: row.variance,
      travelAmount: row.travel_amount,
    };
    branch.vendors.push(vendor);
    branch.qty += row.qty;
    branch.rateCrm += row.rate_crm;
    branch.travelAmount += row.travel_amount;
    if (row.rate_mst != null) branch.rateMst += row.rate_mst;
  }

  for (const branch of byBranch.values()) {
    branch.variance = branch.rateCrm - branch.rateMst;
    branch.vendors.sort((a, b) => {
      const byCode = (a.vendorCode || '').localeCompare(b.vendorCode || '');
      if (byCode !== 0) return byCode;
      return a.franchiseeName.localeCompare(b.franchiseeName);
    });
  }

  const branches = Array.from(byBranch.values()).sort((a, b) =>
    a.branchName.localeCompare(b.branchName)
  );

  let qty = 0;
  let rateMst = 0;
  let rateCrm = 0;
  let travelAmount = 0;
  for (const branch of branches) {
    qty += branch.qty;
    rateMst += branch.rateMst;
    rateCrm += branch.rateCrm;
    travelAmount += branch.travelAmount;
  }

  return {
    branches,
    totals: {
      qty,
      rateMst,
      rateCrm,
      variance: rateCrm - rateMst,
      travelAmount,
    },
  };
}

function normalizeLocal(label: string, code: string): string {
  const fromCode = LOCAL_UPCOUNTRY_NCODE_LABELS[code.trim()];
  if (fromCode) return fromCode;
  const t = label.trim();
  if (/local/i.test(t)) return 'Local';
  if (/up\s*country/i.test(t)) return 'Upcountry';
  return t || code || 'Other';
}

export type ArcpProvisionSummaryDataRow = {
  serviceDescriptionSubLabel: string;
  rateCardUnit: number | null;
  qty: number;
  rateMst: number | null;
  rateCrm: number;
  variance: number | null;
};

export type ArcpProvisionSummarySection = {
  key: string;
  title: string;
  rows: ArcpProvisionSummaryDataRow[];
  qty: number;
  rateMst: number;
  rateCrm: number;
  variance: number;
};

export type ArcpProvisionSummaryBranch = {
  branchId: string;
  branchName: string;
  sections: ArcpProvisionSummarySection[];
  qty: number;
  rateMst: number;
  rateCrm: number;
  variance: number;
  travelAmount: number;
};

export type ArcpProvisionSummaryTableModel = {
  branches: ArcpProvisionSummaryBranch[];
  totals: {
    qty: number;
    rateMst: number;
    rateCrm: number;
    variance: number;
    travelAmount: number;
  };
};

/** Claims-like summary: Branch → BREAKDOWN category → Local-Minor clubbed rows. */
export function buildArcpProvisionSummaryTableModel(
  aggregates: ArcpProvisionCategoryAggregateRow[]
): ArcpProvisionSummaryTableModel {
  type Cell = {
    subLabel: string;
    sortKey: string;
    rateCardUnit: number | null;
    qty: number;
    rateMst: number | null;
    rateCrm: number;
  };
  type Section = { title: string; cells: Map<string, Cell> };
  type Branch = { id: string; name: string; sections: Map<string, Section>; travelAmount: number };

  const branches = new Map<string, Branch>();

  for (const row of aggregates) {
    const branchId = (row.branch_id || '').trim() || '_';
    let branch = branches.get(branchId);
    if (!branch) {
      branch = {
        id: branchId,
        name: (row.branch_name || branchId).trim() || branchId,
        sections: new Map(),
        travelAmount: 0,
      };
      branches.set(branchId, branch);
    }
    branch.travelAmount += row.travel_amount;

    if (row.qty <= 0 && row.rate_crm === 0) continue;

    const callType = (row.call_type_label || row.ncalltype || '').trim() || 'Unknown';
    const category = (row.item_category_label || row.nitemcategory || '').trim() || 'Unknown';
    const sectionKey = `${callType}\0${category}`;
    const title = `${callType} – ${category}`;
    let section = branch.sections.get(sectionKey);
    if (!section) {
      section = { title, cells: new Map() };
      branch.sections.set(sectionKey, section);
    }

    const local = normalizeLocal(row.local_upcountry_label, row.nlocalupcountry);
    const majorMinor = row.major_minor || (row.is_major ? 'Major' : 'Minor');
    const subLabel = `${local} - ${majorMinor}`;
    const sortKey = `${local === 'Local' ? '0' : local === 'Upcountry' ? '1' : '2'}-${majorMinor === 'Major' ? '0' : '1'}-${subLabel}`;

    const existing = section.cells.get(sortKey);
    if (existing) {
      existing.qty += row.qty;
      existing.rateCrm += row.rate_crm;
      if (row.rate_mst != null) {
        existing.rateMst = (existing.rateMst ?? 0) + row.rate_mst;
      }
      if (
        row.rate_card_unit != null &&
        existing.rateCardUnit != null &&
        Math.abs(existing.rateCardUnit - row.rate_card_unit) > 0.01
      ) {
        existing.rateCardUnit = null;
      } else if (existing.rateCardUnit == null && row.rate_card_unit != null) {
        existing.rateCardUnit = row.rate_card_unit;
      }
    } else {
      section.cells.set(sortKey, {
        subLabel,
        sortKey,
        rateCardUnit: row.rate_card_unit,
        qty: row.qty,
        rateMst: row.rate_mst,
        rateCrm: row.rate_crm,
      });
    }
  }

  const outBranches: ArcpProvisionSummaryBranch[] = [];
  let totalQty = 0;
  let totalRateMst = 0;
  let totalRateCrm = 0;
  let totalTravel = 0;

  const sortedBranches = Array.from(branches.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const branch of sortedBranches) {
    const sections: ArcpProvisionSummarySection[] = [];
    let branchQty = 0;
    let branchRateMst = 0;
    let branchRateCrm = 0;

    const sortedSections = Array.from(branch.sections.entries()).sort((a, b) =>
      a[1].title.localeCompare(b[1].title)
    );
    for (const [sectionKey, section] of sortedSections) {
      const rows: ArcpProvisionSummaryDataRow[] = [];
      let sectionQty = 0;
      let sectionRateMst = 0;
      let sectionRateCrm = 0;
      const cells = Array.from(section.cells.values()).sort((a, b) =>
        a.sortKey.localeCompare(b.sortKey)
      );
      for (const cell of cells) {
        if (cell.qty <= 0) continue;
        const variance = cell.rateMst == null ? null : cell.rateCrm - cell.rateMst;
        rows.push({
          serviceDescriptionSubLabel: cell.subLabel,
          rateCardUnit: cell.rateCardUnit,
          qty: cell.qty,
          rateMst: cell.rateMst,
          rateCrm: cell.rateCrm,
          variance,
        });
        sectionQty += cell.qty;
        sectionRateCrm += cell.rateCrm;
        if (cell.rateMst != null) sectionRateMst += cell.rateMst;
      }
      if (rows.length === 0) continue;
      sections.push({
        key: sectionKey,
        title: section.title,
        rows,
        qty: sectionQty,
        rateMst: sectionRateMst,
        rateCrm: sectionRateCrm,
        variance: sectionRateCrm - sectionRateMst,
      });
      branchQty += sectionQty;
      branchRateMst += sectionRateMst;
      branchRateCrm += sectionRateCrm;
    }

    outBranches.push({
      branchId: branch.id,
      branchName: branch.name,
      sections,
      qty: branchQty,
      rateMst: branchRateMst,
      rateCrm: branchRateCrm,
      variance: branchRateCrm - branchRateMst,
      travelAmount: branch.travelAmount,
    });
    totalQty += branchQty;
    totalRateMst += branchRateMst;
    totalRateCrm += branchRateCrm;
    totalTravel += branch.travelAmount;
  }

  return {
    branches: outBranches,
    totals: {
      qty: totalQty,
      rateMst: totalRateMst,
      rateCrm: totalRateCrm,
      variance: totalRateCrm - totalRateMst,
      travelAmount: totalTravel,
    },
  };
}
