import { SapSupplierGroup } from './sap-parser';
import { CrmStockRow, CrmVendorPlant } from './crm-query';

export type ReconciledRow = {
  plant: string;
  vendor: string;
  vendorName: string;
  material: string;
  description: string;
  group: string;
  uom: string;
  sapQty: number;
  crmQty: number;
  difference: number;
};

export type ReconciliationSummary = {
  totalRecords: number;
  matches: number;
  discrepancies: number;
  sapOnly: number;
  crmOnly: number;
  skippedPlants?: string[];
  skippedVendors?: string[];
  skippedMaterials?: string[];
};

/**
 * Normalizes vendor code to extract the base numeric part (e.g. "305632-BLK" -> "305632")
 */
export function normalizeVendorCode(code: string): string {
  const match = code.trim().match(/^(\d+)/);
  return match ? match[1] : code.trim();
}

/**
 * Normalizes material code to strip leading zeros and trim whitespace
 */
export function normalizeMaterialCode(code: string): string {
  return code.replace(/^0+/, '').trim();
}

/**
 * Checks if a specific plant, vendor, or material should be skipped based on rules
 */
export function shouldSkipRow(
  plant: string,
  vendor: string,
  material: string,
  skipRules?: Array<{ type: 'PLANT' | 'VENDOR' | 'MATERIAL'; code: string }>
): boolean {
  if (!skipRules || skipRules.length === 0) return false;

  const normVendor = normalizeVendorCode(vendor);
  const normMaterial = normalizeMaterialCode(material);

  for (const rule of skipRules) {
    if (rule.type === 'PLANT' && rule.code.trim() === plant.trim()) {
      return true;
    }
    if (rule.type === 'VENDOR' && normalizeVendorCode(rule.code) === normVendor) {
      return true;
    }
    if (rule.type === 'MATERIAL' && normalizeMaterialCode(rule.code) === normMaterial) {
      return true;
    }
  }

  return false;
}

/**
 * Reconciles SAP MBLB stock against CRM mirror stock.
 */
export function reconcileStock(
  sapGroups: SapSupplierGroup[],
  crmRows: CrmStockRow[],
  vendorPlantMap?: Map<string, CrmVendorPlant>,
  skipRules?: Array<{ type: 'PLANT' | 'VENDOR' | 'MATERIAL'; code: string }>
): { rows: ReconciledRow[]; summary: ReconciliationSummary } {
  const sapMap = new Map<string, {
    materialCode: string;
    description: string;
    plantCode: string;
    quantity: number;
    unit: string;
    supplierCode: string;
    supplierName: string;
    materialGroup?: string;
  }>();

  const skippedPlants = new Set<string>();
  const skippedVendors = new Set<string>();
  const skippedMaterials = new Set<string>();

  const trackSkips = (p: string, v: string, m: string) => {
    if (!skipRules) return;
    const normVendor = normalizeVendorCode(v);
    const normMaterial = normalizeMaterialCode(m);
    for (const rule of skipRules) {
      if (rule.type === 'PLANT' && rule.code.trim() === p.trim()) skippedPlants.add(p);
      if (rule.type === 'VENDOR' && normalizeVendorCode(rule.code) === normVendor) skippedVendors.add(v);
      if (rule.type === 'MATERIAL' && normalizeMaterialCode(rule.code) === normMaterial) skippedMaterials.add(m);
    }
  };

  // Load SAP items into Map
  for (const group of sapGroups) {
    const normVendor = normalizeVendorCode(group.supplierCode);
    const mappedPlantInfo = vendorPlantMap?.get(normVendor);

    for (const item of group.items) {
      const normMaterial = normalizeMaterialCode(item.materialCode);
      const plantCode = mappedPlantInfo?.plantCode || item.plantCode;

      if (shouldSkipRow(plantCode, normVendor, normMaterial, skipRules)) {
        trackSkips(plantCode, normVendor, normMaterial);
        continue;
      }

      const key = `${plantCode}|${normVendor}|${normMaterial}`;
      const existing = sapMap.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        sapMap.set(key, {
          materialCode: normMaterial,
          description: item.description,
          plantCode: plantCode,
          quantity: item.quantity,
          unit: item.unit,
          supplierCode: group.supplierCode,
          supplierName: group.supplierName,
          materialGroup: item.materialGroup,
        });
      }
    }
  }

  // Load CRM items into Map
  const crmMap = new Map<string, CrmStockRow>();
  for (const row of crmRows) {
    const normVendor = normalizeVendorCode(row.vendorCode);
    const normMaterial = normalizeMaterialCode(row.materialCode);

    if (shouldSkipRow(row.plantCode, normVendor, normMaterial, skipRules)) {
      trackSkips(row.plantCode, normVendor, normMaterial);
      continue;
    }

    const key = `${row.plantCode}|${normVendor}|${normMaterial}`;
    const existing = crmMap.get(key);
    if (existing) {
      existing.crmQty += row.crmQty;
    } else {
      crmMap.set(key, {
        ...row,
        materialCode: normMaterial,
      });
    }
  }

  // Build a unified vendor name map (preferring SAP names, falling back to CRM names)
  const vendorNameMap = new Map<string, string>();
  for (const group of sapGroups) {
    const normVendor = normalizeVendorCode(group.supplierCode);
    if (group.supplierName) {
      vendorNameMap.set(normVendor, group.supplierName.trim());
    }
  }
  for (const row of crmRows) {
    const normVendor = normalizeVendorCode(row.vendorCode);
    if (row.vendorName && !vendorNameMap.has(normVendor)) {
      vendorNameMap.set(normVendor, row.vendorName.trim());
    }
  }

  // Build unified maps for material descriptions and groups (preferring CRM, falling back to SAP)
  const materialDescMap = new Map<string, string>();
  const materialGroupMap = new Map<string, string>();

  for (const row of crmRows) {
    const normMaterial = normalizeMaterialCode(row.materialCode);
    if (row.materialDescription) {
      materialDescMap.set(normMaterial, row.materialDescription.trim());
    }
    if (row.materialGroup) {
      materialGroupMap.set(normMaterial, row.materialGroup.trim());
    }
  }

  for (const group of sapGroups) {
    for (const item of group.items) {
      const normMaterial = normalizeMaterialCode(item.materialCode);
      if (item.description && !materialDescMap.has(normMaterial)) {
        materialDescMap.set(normMaterial, item.description.trim());
      }
      if (item.materialGroup && !materialGroupMap.has(normMaterial)) {
        materialGroupMap.set(normMaterial, item.materialGroup.trim());
      }
    }
  }

  // Find all unique keys
  const allKeys = new Set([...sapMap.keys(), ...crmMap.keys()]);
  const reconciledRows: ReconciledRow[] = [];

  for (const key of allKeys) {
    const sapItem = sapMap.get(key);
    const crmItem = crmMap.get(key);

    const [plantCode, vendorCode, materialCode] = key.split('|');

    const plant = sapItem?.plantCode || crmItem?.plantCode || plantCode;
    const vendor = sapItem?.supplierCode || crmItem?.vendorCode || vendorCode;

    const normVendor = normalizeVendorCode(vendor);
    const vendorName = vendorNameMap.get(normVendor) || sapItem?.supplierName || crmItem?.vendorName || 'Unknown Vendor';

    const material = sapItem?.materialCode || crmItem?.materialCode || materialCode;
    const normMaterial = normalizeMaterialCode(material);

    const description = materialDescMap.get(normMaterial) || crmItem?.materialDescription || sapItem?.description || 'Unknown Item';
    const group = materialGroupMap.get(normMaterial) || crmItem?.materialGroup || sapItem?.materialGroup || 'Unknown';
    const uom = crmItem?.uom || sapItem?.unit || 'NOS';

    const sapQty = sapItem?.quantity || 0;
    const crmQty = crmItem?.crmQty || 0;
    const difference = sapQty - crmQty;

    // Filter out items that have 0 quantity in both systems
    if (sapQty === 0 && crmQty === 0) {
      continue;
    }

    reconciledRows.push({
      plant,
      vendor,
      vendorName,
      material,
      description,
      group,
      uom,
      sapQty,
      crmQty,
      difference,
    });
  }

  // Sort rows: Plant, Vendor, Material
  reconciledRows.sort((a, b) => {
    return a.plant.localeCompare(b.plant) ||
           a.vendor.localeCompare(b.vendor) ||
           a.material.localeCompare(b.material);
  });

  const matches = reconciledRows.filter(r => r.difference === 0).length;
  const discrepancies = reconciledRows.filter(r => r.difference !== 0).length;
  const sapOnly = reconciledRows.filter(r => r.sapQty > 0 && r.crmQty === 0).length;
  const crmOnly = reconciledRows.filter(r => r.crmQty > 0 && r.sapQty === 0).length;

  return {
    rows: reconciledRows,
    summary: {
      totalRecords: reconciledRows.length,
      matches,
      discrepancies,
      sapOnly,
      crmOnly,
      skippedPlants: Array.from(skippedPlants),
      skippedVendors: Array.from(skippedVendors),
      skippedMaterials: Array.from(skippedMaterials),
    },
  };
}
