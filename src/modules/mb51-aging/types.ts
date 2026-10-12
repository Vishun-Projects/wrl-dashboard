export type Mb51AgingMovement = {
  d: number;      // Excel serial posting date
  q: number;      // Quantity in unit of entry
  m: string;      // Material code
  md: string;     // Material description
  g: string;      // Material group
  u: string;      // Unit of measure
  v: string;      // Vendor / supplier code
  vn: string;     // Vendor / supplier name
  mv: string;     // Plant
  s: number;      // Sequence order
  dc?: string;    // Material document
  mt?: string;    // Movement type
  mtx?: string;   // Movement type text
};

export type Mb51AgingImportMeta = {
  id: string;
  fileName: string;
  uploadedBy: string | null;
  rowCount: number;
  plantCount: number;
  materialCount: number;
  importedAt: string;
};

export type Mb51AgingApiResponse = {
  latestImport: Mb51AgingImportMeta | null;
  rows: Mb51AgingMovement[];
};

export type Mb51AgingSavePayload = {
  fileName: string;
  rows: Mb51AgingMovement[];
  replaceExisting?: boolean;
};

export type Mb51AgingBucket = {
  k: string;
  l: string;
  min: number;
  max: number;
  c: string;
};

export type Mb51AgingAggRow = {
  a?: string;  // Vendor code
  b?: string;  // Vendor name
  c?: string;  // Material group
  d?: string;  // Material code
  e?: string;  // Material description
  u?: string;  // UoM
  bk: number[];
  det: [Mb51AgingMovement, number, number][][]; // per bucket: [movement, allocatedQty, ageInDays]
  total: number;
  n: number;
  [key: string]: unknown;
};

export type Mb51AgingResult = {
  rows: Mb51AgingAggRow[];
  tot: number[];
  gb: 'mat' | 'vendor' | 'group' | 'vm';
  basis: number;
  from: number;
  to: number;
  used: number;
  negMat: number;
  negQty: number;
  plugged: number;
  plugQty: number;
  stockMat: number;
};
