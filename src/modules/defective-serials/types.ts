export type DefectiveSerialStatus = 'pending' | 'done' | 'all';

export type DefectiveSerialRow = {
  ncode: string;
  ncalls: string;
  nofficeid: string;
  vtrnno: string;
  dtrndate: string | null;
  party_name: string | null;
  client_name: string | null;
  model: string | null;
  machine_serial: string | null;
  city: string | null;
  call_centre_call_id: string | null;
  branch_name: string | null;
  plant_code: string | null;
  call_type: string | null;
  vendor_name: string | null;
  vendor_code: string | null;
  defective_item_code: string | null;
  defective_item_name: string | null;
  voldserialno: string | null;
  breturntobranch: boolean;
  dreturntobranchdate: string | null;
  nreturntobranch: string | null;
  return_by_name: string | null;
  status: 'pending' | 'done';
};

export type DefectiveSerialsRowsResponse = {
  rows: DefectiveSerialRow[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
  doneCount: number;
};

export type DefectiveSerialsOptionsResponse = {
  plants: string[];
  branches: string[];
  callTypes: string[];
};
