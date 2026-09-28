import type { SpareStockDupPreviewRow, SpareStockParsedRow } from '@/modules/spare-stock-analysis/types';

export function groupByRowKey(rows: SpareStockParsedRow[]): Map<string, SpareStockParsedRow[]> {
  const groups = new Map<string, SpareStockParsedRow[]>();
  for (const r of rows) {
    const list = groups.get(r.rowKey) ?? [];
    list.push(r);
    groups.set(r.rowKey, list);
  }
  return groups;
}

export function toDupPreview(row: SpareStockParsedRow, copies: number): SpareStockDupPreviewRow {
  return {
    plant: row.plant,
    postingDate: row.postingDate,
    matDoc: row.matDoc,
    material: row.material,
    materialDescription: row.materialDescription,
    qty: row.qty,
    mvt: row.mvt,
    supplier: row.supplier,
    callNo: row.callNo,
    copies,
  };
}

/** First occurrence keeps the fingerprint; extras get #2, #3 so they can be stored. */
export function keyedCopy(row: SpareStockParsedRow, copyIndex: number): SpareStockParsedRow {
  if (copyIndex <= 1) return row;
  return { ...row, rowKey: `${row.rowKey}#${copyIndex}` };
}
