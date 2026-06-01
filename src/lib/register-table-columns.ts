export type RegisterTableColumnKey =
  | 'UniqueCallNo'
  | 'vcclid'
  | 'calltype'
  | 'callsdtrndate'
  | 'PartyName'
  | 'officename'
  | 'franchisee_name'
  | 'Pincode'
  | 'itemname'
  | 'callsvserialno'
  | 'serviceman'
  | 'vcomplaint'
  | 'Status'
  | 'portal_action'
  | 'callsolveddate'
  | 'vsolveremarks'
  | 'vpersoncalling'
  | 'vinsttel1'
  | 'vinstaddress';

export type RegisterTableColumnDef = {
  key: RegisterTableColumnKey;
  label: string;
};

export const REGISTER_TABLE_COLUMNS: RegisterTableColumnDef[] = [
  { key: 'UniqueCallNo', label: 'ID' },
  { key: 'vcclid', label: 'Call Centre ID' },
  { key: 'calltype', label: 'Call Type' },
  { key: 'callsdtrndate', label: 'Date' },
  { key: 'PartyName', label: 'Customer' },
  { key: 'officename', label: 'Branch' },
  { key: 'franchisee_name', label: 'Franchisee' },
  { key: 'Pincode', label: 'Pincode' },
  { key: 'itemname', label: 'Product' },
  { key: 'callsvserialno', label: 'Serial' },
  { key: 'serviceman', label: 'Technician' },
  { key: 'vcomplaint', label: 'Complaint' },
  { key: 'Status', label: 'Status' },
  { key: 'portal_action', label: 'Portal Action' },
  { key: 'callsolveddate', label: 'Solved' },
  { key: 'vsolveremarks', label: 'Remarks' },
  { key: 'vpersoncalling', label: 'Contact Person' },
  { key: 'vinsttel1', label: 'Phone' },
  { key: 'vinstaddress', label: 'Address' },
];

export const REGISTER_TABLE_COLUMN_KEYS = REGISTER_TABLE_COLUMNS.map((c) => c.key);

/** CSV / Excel export columns (subset + display fields). */
export const REGISTER_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'UniqueCallNo', header: 'ID' },
  { key: 'vcclid', header: 'Call Centre ID' },
  { key: 'calltype', header: 'Call Type' },
  { key: 'callsdtrndate', header: 'Date' },
  { key: 'PartyName', header: 'Customer' },
  { key: 'officename', header: 'Branch' },
  { key: 'franchisee_name', header: 'Franchisee' },
  { key: 'Pincode', header: 'Pincode' },
  { key: 'itemname', header: 'Product' },
  { key: 'callsvserialno', header: 'Serial' },
  { key: 'serviceman', header: 'Technician' },
  { key: 'vcomplaint', header: 'Complaint' },
  { key: 'display_status', header: 'Status' },
  { key: 'solvedDate', header: 'Solved Date' },
  { key: 'remarks', header: 'Remarks' },
  { key: 'vpersoncalling', header: 'Contact Person' },
  { key: 'vinsttel1', header: 'Phone' },
  { key: 'vinstaddress', header: 'Address' },
];

export const REGISTER_COLUMNS_STORAGE_KEY = 'mis_register_visible_columns';

export function loadVisibleRegisterColumns(): RegisterTableColumnKey[] {
  if (typeof window === 'undefined') return [...REGISTER_TABLE_COLUMN_KEYS];
  try {
    const saved = localStorage.getItem(REGISTER_COLUMNS_STORAGE_KEY);
    if (!saved) return [...REGISTER_TABLE_COLUMN_KEYS];
    const parsed = JSON.parse(saved) as string[];
    const valid = parsed.filter((k): k is RegisterTableColumnKey =>
      REGISTER_TABLE_COLUMN_KEYS.includes(k as RegisterTableColumnKey)
    );
    return valid.length > 0 ? valid : [...REGISTER_TABLE_COLUMN_KEYS];
  } catch {
    return [...REGISTER_TABLE_COLUMN_KEYS];
  }
}

export function saveVisibleRegisterColumns(columns: RegisterTableColumnKey[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REGISTER_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
}
