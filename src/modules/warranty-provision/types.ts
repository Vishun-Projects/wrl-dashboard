export type WarrantyProvisionRow = {
  id: number;
  billingDocument: string;
  billingDate: string | null;
  billingYear: number | null;
  material: string;
  serialNumber: string;
  materialGroup: string;
  externalMaterialGroup: string;
  soldToPartyName: string;
  customerSubgroup: string;
  shipToPartyName: string;
  shipToPartyState: string;
  shipToPartyCity: string;
  inventoryNumber: string;
  warrantyStart: string | null;
  warrantyEndDate: string | null;
  days: number | null;
  remainingDays: number | null;
  warrantyStatus: 'Active' | 'Inactive' | null;
  warrantyEndFy: string;
};

export type WarrantyProvisionOptions = {
  materialGroups: string[];
  customerSubgroups: string[];
  states: string[];
  cities: string[];
  materials: string[];
  warrantyEndFys: string[];
};

export type WarrantyProvisionRowsResponse = {
  rows: WarrantyProvisionRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type { SnapResponse } from '@/modules/warranty-provision/server/snap';
export type { ActiveUnitsResponse, ActiveUnitsRow } from '@/modules/warranty-provision/server/active-units';
export type {
  BreakdownMfgDetailResponse,
  BreakdownMfgDetailRow,
  BreakdownMfgResponse,
  BreakdownMfgResponseWithBasis,
  BreakdownMfgRow,
} from '@/modules/warranty-provision/server/breakdown-mfg';

export type WarrantyClaimRow = {
  id: number;
  claimNo: string;
  serialNumber: string;
  claimDate: string | null;
  defectDescription: string;
  repairCost: number | null;
  sparePartsCost: number | null;
  labourCost: number | null;
  /** Travel cost from ARCP provision (was Replacement Cost). */
  travelingReimbursement: number | null;
  totalCost: number | null;
  unitId: number | null;
  matchStatus: string;
};

export type WarrantyAssumptions = {
  inflationPct: number;
  discountPct: number;
  optimisticProbMult: number;
  optimisticCostMult: number;
  pessimisticProbMult: number;
  pessimisticCostMult: number;
  forecastStart: string | null;
  includeFutureSales: boolean;
  existingProvision: number;
  usingDefaults: boolean;
};

export type WarrantyRatesResponse = {
  asOf: string;
  exposureUnitYears: number;
  totalClaims: number;
  matchedClaims: number;
  overallClaimPct: number | null;
  exposureClaimRate: number | null;
  avgClaimCost: number | null;
  byMaterialGroup: Array<{
    materialGroup: string;
    units: number;
    claims: number;
    avgCost: number | null;
    flagged: boolean;
  }>;
  byAgeBand: Array<{ band: string; exposed: number; claims: number; hazard: number | null }>;
  assumptionBadge: string;
};

export type WarrantyForecastResponse = {
  asOf: string;
  forecastStart: string;
  scenario: 'base' | 'optimistic' | 'pessimistic';
  kpis: {
    installedUnderWarranty: number;
    totalClaims: number;
    overallClaimPct: number | null;
    avgClaimCost: number | null;
    expectedClaims12m: number;
    projectedCost12m: number;
    projectedCost3y: number;
    projectedCost5y: number;
  };
  monthly: Array<{ period: string; expectedClaims: number; cost: number; cumulativeCost: number }>;
  scenarios: {
    optimistic: { claims12m: number; cost12m: number };
    base: { claims12m: number; cost12m: number };
    pessimistic: { claims12m: number; cost12m: number };
  };
  provision: {
    required: number;
    existing: number;
    gap: number;
    note: string;
  };
  reconciliations: string[];
  methodology: string[];
};
