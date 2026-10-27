export type MmDocBarcodeRow = {
  plant: string;
  storageLocation: string;
  materialDocument: string;
  postingDate: string | null;
  material: string;
  objectDescription: string;
  movementType: string;
};

export type MmDocBarcodeImportMeta = {
  id: string;
  fileName: string;
  rowCount: number;
  importedAt: string;
};
