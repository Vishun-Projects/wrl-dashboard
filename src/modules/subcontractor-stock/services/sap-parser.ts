import fs from 'fs';
import * as cheerio from 'cheerio';

export type SapItem = {
  materialCode: string;
  description: string;
  plantCode: string;
  batch: string;
  quantity: number;
  unit: string;
  materialGroup?: string;
};

export type SapSupplierGroup = {
  supplierCode: string;
  supplierName: string;
  items: SapItem[];
};

/**
 * Parses an SAP MBLB HTML stock report. Supports both legacy hierarchical and new flat-table formats.
 */
export function parseSapMblbHtml(filePath: string): SapSupplierGroup[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SAP MBLB report file not found: ${filePath}`);
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);

  // Detect format: if any table row contains "plant code", "supplier code", and "material code"
  let isModern = false;
  $('tr').each((idx, tr) => {
    if (isModern) return;
    const cells = $(tr).find('td');
    if (cells.length >= 8) {
      const rowTexts = cells.map((i, el) => $(el).text().trim().replace(/\u00a0/g, ' ')).get();
      const hasPlantCode = rowTexts.some(t => t.toLowerCase() === 'plant code');
      const hasSupplierCode = rowTexts.some(t => t.toLowerCase() === 'supplier code');
      const hasMaterialCode = rowTexts.some(t => t.toLowerCase() === 'material code');
      if (hasPlantCode && hasSupplierCode && hasMaterialCode) {
        isModern = true;
      }
    }
  });

  if (isModern) {
    return parseModernFormat($, html);
  } else {
    return parseLegacyFormat($);
  }
}

function parseModernFormat($: cheerio.CheerioAPI, _html: string): SapSupplierGroup[] {
  const tables = $('table');
  const groups: SapSupplierGroup[] = [];

  tables.each((tIdx, tableEl) => {
    const rows = $(tableEl).find('tr');
    if (rows.length === 0) return;

    let plantCodeIdx = -1;
    let supplierCodeIdx = -1;
    let supplierNameIdx = -1;
    let materialCodeIdx = -1;
    let descriptionIdx = -1;
    let qtyIdx = -1;
    let unitIdx = -1;
    let matlGroupIdx = -1;
    let headerRowIdx = -1;

    // Search the first few rows for the header
    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const cellTexts = $(rows.get(r)).find('td').map((i, el) => $(el).text().trim().replace(/\u00a0/g, ' ')).get();
      let hasPlant = false;
      let hasSupplier = false;
      let hasMaterial = false;

      for (let i = 0; i < cellTexts.length; i++) {
        const txt = cellTexts[i].toLowerCase().replace(/\s+/g, ' ');
        if (txt.includes('plant code')) hasPlant = true;
        if (txt.includes('supplier code')) hasSupplier = true;
        if (txt.includes('material code')) hasMaterial = true;
      }

      if (hasPlant && hasSupplier && hasMaterial) {
        headerRowIdx = r;
        for (let i = 0; i < cellTexts.length; i++) {
          const txt = cellTexts[i].toLowerCase().replace(/\s+/g, ' ');
          if (txt.includes('plant code')) plantCodeIdx = i;
          else if (txt.includes('supplier code')) supplierCodeIdx = i;
          else if (txt.includes('supplier name')) supplierNameIdx = i;
          else if (txt.includes('material code')) materialCodeIdx = i;
          else if (txt.includes('material description')) descriptionIdx = i;
          else if (txt.includes('stock at supplier')) qtyIdx = i;
          else if (txt.includes('uom')) unitIdx = i;
          else if (txt.includes('matl.group') || txt.includes('matl group') || txt.includes('material group')) matlGroupIdx = i;
        }
        break;
      }
    }

    if (plantCodeIdx !== -1 && supplierCodeIdx !== -1 && materialCodeIdx !== -1 && qtyIdx !== -1) {
      rows.slice(headerRowIdx + 1).each((rIdx, rowEl) => {
        const cells = $(rowEl).find('td');
        if (cells.length <= Math.max(plantCodeIdx, supplierCodeIdx, materialCodeIdx, qtyIdx, unitIdx)) {
          return;
        }

        const plantCode = $(cells.get(plantCodeIdx)).text().trim().replace(/\u00a0/g, ' ');
        const supplierCode = $(cells.get(supplierCodeIdx)).text().trim().replace(/\u00a0/g, ' ');
        const supplierName = supplierNameIdx !== -1 
          ? $(cells.get(supplierNameIdx)).text().trim().replace(/\u00a0/g, ' ') 
          : 'Unknown Vendor';
        const materialCode = $(cells.get(materialCodeIdx)).text().trim().replace(/\u00a0/g, ' ');
        const description = descriptionIdx !== -1 
          ? $(cells.get(descriptionIdx)).text().trim().replace(/\u00a0/g, ' ') 
          : '';
        const qtyStr = $(cells.get(qtyIdx)).text().trim().replace(/\u00a0/g, ' ').replace(/,/g, '');
        const unit = unitIdx !== -1 
          ? $(cells.get(unitIdx)).text().trim().replace(/\u00a0/g, ' ') 
          : 'NOS';
        const materialGroup = matlGroupIdx !== -1
          ? $(cells.get(matlGroupIdx)).text().trim().replace(/\u00a0/g, ' ')
          : '';

        if (!plantCode || !supplierCode || !materialCode) return;
        if (!/^\d+$/.test(plantCode) || !/^\d+$/.test(supplierCode) || !/^\d+$/.test(materialCode)) return;

        const quantity = parseFloat(qtyStr);

        let group = groups.find(g => g.supplierCode === supplierCode);
        if (!group) {
          group = { supplierCode, supplierName, items: [] };
          groups.push(group);
        }

        group.items.push({
          materialCode,
          description,
          plantCode,
          batch: '',
          quantity: isNaN(quantity) ? 0 : quantity,
          unit: unit || 'NOS',
          materialGroup: materialGroup || 'Unknown'
        });
      });
    }
  });

  return groups;
}

function parseLegacyFormat($: cheerio.CheerioAPI): SapSupplierGroup[] {
  const tables = $('table');
  const groups: SapSupplierGroup[] = [];
  
  let currentSupplier: { code: string; name: string } | null = null;
  let currentGroup: SapSupplierGroup | null = null;

  tables.each((tIdx, tableEl) => {
    $(tableEl).find('tr').each((rIdx, rowEl) => {
      const line = $(rowEl).text().replace(/\u00a0/g, ' ');
      const trimmed = line.trim();

      // Skip header lines
      if (trimmed.startsWith('Supplier Name') || trimmed.startsWith('Material Material Description')) {
        return;
      }
      if (!trimmed) return;

      // Detect supplier row (e.g. "305632 YOGESH HUNDARE      MUMBAI")
      const supplierMatch = trimmed.match(/^(\d{6})\s+(.+)$/);
      if (supplierMatch) {
        const code = supplierMatch[1];
        const name = supplierMatch[2].trim();
        currentSupplier = { code, name };
        currentGroup = groups.find(g => g.supplierCode === code) || null;
        if (!currentGroup) {
          currentGroup = { supplierCode: code, supplierName: name, items: [] };
          groups.push(currentGroup);
        }
        return;
      }

      // Detect material row (starts with a 7 to 10-digit material code)
      const materialCode = line.substring(0, 9).trim();
      if (/^\d{7,10}$/.test(materialCode)) {
        if (!currentSupplier || !currentGroup) {
          return;
        }

        const description = line.substring(9, 50).trim();
        const plantCode = line.substring(50, 56).trim();
        const batch = line.substring(56, 62).trim();
        const qtyStr = line.substring(62, 75).trim().replace(/,/g, '');
        const unit = line.substring(108, 114).trim();
        const quantity = parseFloat(qtyStr);

        currentGroup.items.push({
          materialCode,
          description,
          plantCode,
          batch,
          quantity: isNaN(quantity) ? 0 : quantity,
          unit: unit || 'NOS'
        });
      }
    });
  });

  return groups;
}
