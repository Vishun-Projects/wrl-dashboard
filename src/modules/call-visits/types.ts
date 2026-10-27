export type CallPartRow = {
  ncode: string;
  nofficeid: string;
  callNo: string | null;
  visitNo: string | null;
  visitAt: string | null;
  partCategory: string | null;
  partCode: string | null;
  /** Consumption SAP material document for the fitted (non-defective) part. */
  sapDoc: string | null;
  /** Defective Generation SAP document. */
  sapDocDefective: string | null;
  /** Summed MB51 qty for Defective Generation. */
  sapDocDefectiveQty: string | null;
  /** Defective Receipt SAP document. */
  sapDocDefectiveReceipt: string | null;
  /** Summed MB51 qty for Defective Receipt. */
  sapDocDefectiveReceiptQty: string | null;
  /** Object Description barcodes from MM doc import for the matched SAP docs. */
  sapDocBarcode: string | null;
  sapDocBarcodeMismatch: boolean;
  sapDocDefectiveBarcode: string | null;
  sapDocDefectiveBarcodeMismatch: boolean;
  sapDocDefectiveReceiptBarcode: string | null;
  sapDocDefectiveReceiptBarcodeMismatch: boolean;
  partName: string | null;
  qty: string | null;
  oldBarcode: string | null;
  newBarcode: string | null;
  /** Consumption MB51 posting_date − visit date (days). */
  consDaysDiff: number | null;
  remarks: string | null;
  callLoggedAt: string | null;
  barcode: string | null;
  machineName: string | null;
  modelCode: string | null;
  plantName: string | null;
  branchName: string | null;
  partyName: string | null;
  engineerName: string | null;
  clientName: string | null;
  city: string | null;
  statusLabel: string | null;
};

export type CallPartsRowsResponse = {
  rows: CallPartRow[];
  total: number;
  page: number;
  pageSize: number;
  syncedAt: string | null;
};

export type CallPartsOptions = {
  plants: string[];
  branches: string[];
  clients: string[];
  engineers: string[];
  statuses: string[];
  categories: string[];
};
