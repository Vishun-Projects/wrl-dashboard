import * as cheerio from 'cheerio';
import { cellText, cellsToRow, mapHeaders } from '@/modules/spare-stock-analysis/parse-mb51';
import type { SpareStockParsedRow } from '@/modules/spare-stock-analysis/types';

export async function parseMb51Html(html: string): Promise<{ rows: SpareStockParsedRow[]; skipped: number }> {
  const $ = cheerio.load(html);
  let colMap: ReturnType<typeof mapHeaders> = null;
  const rows: SpareStockParsedRow[] = [];
  let skipped = 0;

  for (const tr of $('tr').toArray()) {
    const cells = $(tr)
      .find('td, th')
      .map((__, td) => cellText($(td).text()))
      .get();
    if (cells.length < 6) continue;

    if (!colMap) {
      colMap = mapHeaders(cells.map((h) => h.toLowerCase().replace(/\s+/g, ' ')));
      continue;
    }

    const row = await cellsToRow(cells, colMap);
    if (row === 'skip') {
      skipped += 1;
      continue;
    }
    rows.push(row);
  }

  if (!colMap) {
    throw new Error(
      'Could not find header row (expected Plnt/Plant, Material, MvT, Qty in UnE, Pstng Date)'
    );
  }

  return { rows, skipped };
}
