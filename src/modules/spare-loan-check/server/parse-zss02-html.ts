import * as cheerio from 'cheerio';
import type { Zss02ParsedRow } from '@/modules/spare-loan-check/types';

function cellText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normHeader(raw: string): string {
  return cellText(raw).toLowerCase().replace(/\s+/g, ' ');
}

type ColMap = {
  plant: number;
  vendorNo: number;
  vendorName: number;
  material: number;
  materialDescription: number;
  barcode: number;
  soConRtn: number;
  soLoan: number;
  loanDate: number;
  loanRtnDate: number;
  cnsmpDate: number;
  noCnsmpCount: number;
  saleDate: number;
  saleRtnDate: number;
};

function mapHeaders(cells: string[]): ColMap | null {
  const idx = (pred: (h: string) => boolean): number => cells.findIndex(pred);
  const plant = idx((h) => h === 'plant');
  const vendorNo = idx((h) => h === 'vendor no.' || h === 'vendor no');
  const soLoan = idx((h) => h.includes('so.no.') && h.includes('loan'));
  const soConRtn = idx((h) => h.includes('so.no.') && (h.includes('con/rtn') || h.includes('con / rtn')));
  if (plant < 0 || vendorNo < 0 || soLoan < 0 || soConRtn < 0) return null;

  return {
    plant,
    vendorNo,
    vendorName: idx((h) => h.startsWith('vendor name')),
    material: idx((h) => h === 'material'),
    materialDescription: idx((h) => h.startsWith('material description')),
    barcode: idx((h) => h.includes('barcode')),
    soConRtn,
    soLoan,
    loanDate: idx((h) => h === 'loan_date' || h === 'loan date'),
    loanRtnDate: idx((h) => h.includes('loan') && h.includes('rtn') && h.includes('date')),
    cnsmpDate: idx((h) => h.includes('cnsmp') && h.includes('date')),
    noCnsmpCount: idx((h) => h.includes('no') && h.includes('cnsmp')),
    saleDate: idx((h) => h === 'sale date'),
    saleRtnDate: idx((h) => h.includes('sale') && h.includes('rtn')),
  };
}

function pick(cells: string[], i: number): string {
  if (i < 0 || i >= cells.length) return '';
  return cells[i] ?? '';
}

function isDataPlant(plant: string): boolean {
  const p = plant.replace(/\s+/g, '');
  return /^\d+$/.test(p);
}

/** Parses SAP spare-parts movement HTML (Plant / Vendor / SO columns). */
export function parseZss02Html(html: string): Zss02ParsedRow[] {
  const $ = cheerio.load(html);
  let colMap: ColMap | null = null;
  const rows: Zss02ParsedRow[] = [];

  $('tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((__, td) => cellText($(td).text()))
      .get();
    if (cells.length < 4) return;

    if (!colMap) {
      const headers = cells.map(normHeader);
      colMap = mapHeaders(headers);
      return;
    }

    const plant = pick(cells, colMap.plant);
    if (!isDataPlant(plant)) return;

    rows.push({
      plant: plant.replace(/\s+/g, ''),
      vendorNo: pick(cells, colMap.vendorNo).replace(/\s+/g, ''),
      vendorName: pick(cells, colMap.vendorName),
      material: pick(cells, colMap.material).replace(/\s+/g, ''),
      materialDescription: pick(cells, colMap.materialDescription),
      barcode: pick(cells, colMap.barcode),
      soConRtn: pick(cells, colMap.soConRtn),
      soLoan: pick(cells, colMap.soLoan),
      loanDate: pick(cells, colMap.loanDate),
      loanRtnDate: pick(cells, colMap.loanRtnDate),
      cnsmpDate: pick(cells, colMap.cnsmpDate),
      noCnsmpCount: pick(cells, colMap.noCnsmpCount),
      saleDate: pick(cells, colMap.saleDate),
      saleRtnDate: pick(cells, colMap.saleRtnDate),
    });
  });

  if (!colMap) {
    throw new Error(
      'Could not find header row (expected Plant, Vendor No., SO.No.(Loan), SO.No.(Con/Rtn))'
    );
  }

  return rows;
}
