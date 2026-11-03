export type WarrantyProvisionRow = {
  id: number;
  billingDocument: string;
  billingDate: string | null;
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
  warrantyRemainingDays: string;
  warrantyEndFy: string;
};

export type WarrantyProvisionOptions = {
  materialGroups: string[];
  customerSubgroups: string[];
  states: string[];
  cities: string[];
  materials: string[];
  warrantyRemainingDays: string[];
  warrantyEndFys: string[];
};

export type WarrantyProvisionRowsResponse = {
  rows: WarrantyProvisionRow[];
  total: number;
  page: number;
  pageSize: number;
};
