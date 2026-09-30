export type SpareStockTxnType = 'opening' | 'receipt' | 'issued' | 'consumption' | 'other';

export type SpareStockParsedRow = {
  plant: string;
  matDoc: string;
  docDate: string | null;
  postingDate: string;
  material: string;
  materialDescription: string;
  location: string;
  uom: string;
  qty: number;
  lcAmount: number | null;
  mvt: string;
  mvtText: string;
  txnType: SpareStockTxnType;
  batch: string;
  entryDate: string | null;
  entryTime: string;
  sapUser: string;
  materialGroup: string;
  customer: string;
  headerText: string;
  callNo: string;
  matYr: string;
  orderNo: string;
  supplier: string;
  rowKey: string;
};

export type SpareStockKpis = {
  opening: number;
  received: number;
  issued: number;
  consumption: number;
  closing: number;
};

export type SpareStockBreakdownRow = {
  key: string;
  label: string;
  opening: number;
  received: number;
  issued: number;
  consumption: number;
  closing: number;
};

export type SpareStockPlantMaterialRow = {
  key: string;
  plant: string;
  plantLabel: string;
  material: string;
  materialDescription: string;
  uom: string;
  opening: number;
  received: number;
  issued: number;
  consumption: number;
  closing: number;
};

export type SpareStockPartRow = {
  material: string;
  materialDescription: string;
  qty: number;
};

export type SpareStockUnmappedMvt = {
  mvt: string;
  mvtText: string;
  count: number;
};

export type SpareStockLastImport = {
  fileName: string;
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  importedAt: string;
};

export type SpareStockMovementRow = {
  plant: string;
  plantLabel: string;
  postingDate: string;
  matDoc: string;
  material: string;
  materialDescription: string;
  uom: string;
  qty: number;
  mvt: string;
  txnType: SpareStockTxnType;
  supplier: string;
  callNo: string;
};

export type SpareStockSummaryResponse = {
  kpis: SpareStockKpis;
  topConsumption: SpareStockPartRow[];
  byPlantMaterial: SpareStockPlantMaterialRow[];
  byBranch: SpareStockBreakdownRow[];
  byFranchisee: SpareStockBreakdownRow[];
  lastImport: SpareStockLastImport | null;
};

export type SpareStockRowsResponse = {
  rows: SpareStockMovementRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type SpareStockOptionsResponse = {
  plants: Array<{ value: string; label: string }>;
  suppliers: Array<{ value: string; label: string }>;
  materials: Array<{ value: string; label: string }>;
  uoms: string[];
};

export type SpareStockImportResponse = {
  kind: 'imported';
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  fileName: string;
  inFileImported: number;
  dbSkipped: number;
  dbReplaced: number;
};

export type SpareStockDupPreviewRow = {
  plant: string;
  postingDate: string;
  matDoc: string;
  material: string;
  materialDescription: string;
  qty: number;
  mvt: string;
  supplier: string;
  callNo: string;
  copies: number;
};

export type SpareStockImportPreview = {
  kind: 'preview';
  fileName: string;
  parsed: number;
  skipped: number;
  newCount: number;
  inFile: { extraCount: number; groups: SpareStockDupPreviewRow[] };
  inDb: { count: number; groups: SpareStockDupPreviewRow[] };
};

export type SpareStockInFileDupesChoice = 'skip' | 'import';
export type SpareStockDbDupesChoice = 'skip' | 'replace' | 'keep';

export type DefectiveReturnRow = {
  plant: string;
  plantLabel: string;
  callNo: string;
  supplier: string;
  supplierLabel: string;
  material: string;
  materialDescription: string;
  consumed: number;
  received: number;
  outstanding: number;
};

export type DefectiveReturnKpis = {
  consumed: number;
  received: number;
  outstanding: number;
};

export type DefectiveReturnResponse = {
  kpis: DefectiveReturnKpis;
  rows: DefectiveReturnRow[];
  byFranchisee: Array<{
    supplier: string;
    supplierLabel: string;
    consumed: number;
    received: number;
    outstanding: number;
  }>;
};
