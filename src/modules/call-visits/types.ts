export type CallPartRow = {
  ncode: string;
  nofficeid: string;
  callNo: string | null;
  visitNo: string | null;
  visitAt: string | null;
  partCode: string | null;
  partName: string | null;
  qty: string | null;
  oldBarcode: string | null;
  newBarcode: string | null;
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
};
