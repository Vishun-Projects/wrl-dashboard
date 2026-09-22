/** Shared types for the Warranty Master report (CRM mstprorg). */

/** Server/API query string filters (legacy CSV export path). */
export type WarrantyMasterQueryParams = {
  customer?: string | null;
  group?: string | null;
  fgModel?: string | null;
  warrantyMonths?: string | null;
  warrantyMonthsMin?: string | null;
  warrantyMonthsMax?: string | null;
  warrStartFrom?: string | null;
  warrStartTo?: string | null;
  warrEndFrom?: string | null;
  warrEndTo?: string | null;
  activeOnly?: boolean;
  q?: string | null;
  serialNumber?: string | null;
};

/** UI filter state — applied client-side after the full dataset is loaded. */
export type WarrantyMasterClientFilters = {
  selectedCustomer: string[];
  selectedGroup: string[];
  selectedFgModel: string[];
  selectedWarrantyMonths: string[];
  warrEndFrom: string;
  warrEndTo: string;
  activeOnly: boolean;
  serialSearch: string;
};

export type WarrantyMasterSerialRow = {
  ncode?: string | number;
  serialNo: string;
  customerName: string;
  groupName: string;
  customerKey: string;
  groupKey: string;
  warrantyMonths: number;
  fgModel: string;
  warrStartDt: string | null;
  warrEndDt: string | null;
  isActive: boolean;
  billingDoc?: string | null;
  billingDate?: string | null;
  customerSubgroup?: string | null;
  shipToParty?: string | null;
  shipToState?: string | null;
  shipToCity?: string | null;
  inventoryNumber?: string | null;
  city?: string | null;
  pinCode?: string | null;
  sheetYear?: number | null;
};

export type WarrantyMasterExportRow = {
  billingDoc: string | null;
  billingDate: string | null;
  material: string;
  serialNo: string;
  groupName: string;
  materialGroup: string;
  productSubgroup: string | null;
  customerName: string;
  customerSubgroup: string | null;
  shipToParty: string | null;
  shipToState: string | null;
  shipToCity: string | null;
  inventoryNumber: string | null;
  warrStartDt: string | null;
  warrEndDt: string | null;
  city: string | null;
  pinCode: string | null;
  sheetYear: number | null;
  warrantyMonths: number;
  isActive: boolean;
};

export type WarrantyMasterAggregateRow = {
  customerName: string;
  customerSubgroup: string;
  groupName: string;
  customerKey: string;
  groupKey: string;
  warrantyMonths: number;
  machineCount: number;
};

export type WarrantyMasterFgDetailRow = {
  fgModel: string;
  machineCount: number;
};

/** One row per customer × group × warranty months × FG model (cached for client filtering). */
export type WarrantyMasterFgLineRow = {
  customerName: string;
  customerSubgroup: string;
  groupName: string;
  customerKey: string;
  groupKey: string;
  warrantyMonths: number;
  fgModel: string;
  machineCount: number;
  activeMachineCount: number;
  minWarrEnd: string | null;
  maxWarrEnd: string | null;
};

export type WarrantyMasterRowDetailParams = WarrantyMasterQueryParams & {
  customerKey: string;
  groupKey: string;
  customerName: string;
  groupName: string;
  rowWarrantyMonths: number;
};

export type WarrantyMasterDimOption = {
  value: string;
  label: string;
};

export type WarrantyMasterDims = {
  customers: WarrantyMasterDimOption[];
  groups: WarrantyMasterDimOption[];
  fgModels: WarrantyMasterDimOption[];
  warrantyMonths: number[];
};


export type WarrantyMasterHierarchyWarranty = {
  warrantyMonths: number;
  machineCount: number;
  minWarrEnd: string | null;
  maxWarrEnd: string | null;
};

export type WarrantyMasterHierarchyGroup = {
  groupKey: string;
  groupName: string;
  machineCount: number;
  warranties: WarrantyMasterHierarchyWarranty[];
};

export type WarrantyMasterHierarchySubgroup = {
  subgroupKey: string;
  customerSubgroup: string;
  machineCount: number;
  groups: WarrantyMasterHierarchyGroup[];
};

export type WarrantyMasterSummary = {
  totalMachines: number;
  distinctCustomers: number;
  distinctGroups: number;
};
