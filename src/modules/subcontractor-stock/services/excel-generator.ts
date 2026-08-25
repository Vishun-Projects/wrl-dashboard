import ExcelJS from 'exceljs';
import { ReconciledRow } from './reconciliation-engine';

/**
 * Generates a styled Excel workbook for the subcontractor stock reconciliation report.
 */
export async function generateReconciliationExcel(rows: ReconciledRow[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Reconciliation Report');

  // Title Banner
  worksheet.mergeCells('A1:J1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'Subcontractor Stock Quantity Reconciliation Report';
  titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F497D' }, // Navy Blue
  };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 40;

  // Metadata block
  worksheet.mergeCells('A2:J2');
  const metaCell = worksheet.getCell('A2');
  metaCell.value = `Generated At: ${new Date().toLocaleString()} | Total Items: ${rows.length}`;
  metaCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF595959' } };
  metaCell.alignment = { horizontal: 'left', vertical: 'middle' };
  worksheet.getRow(2).height = 20;

  // Header Row
  const headers = [
    'Plant',
    'Vendor',
    'Vendor Name',
    'Material',
    'Description',
    'Group',
    'UOM',
    'SAP Qty',
    'CRM Qty',
    'Difference (SAP - CRM)',
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 26;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF366092' }, // Medium steel blue
    };
    cell.font = {
      name: 'Arial',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
  });

  // Data Rows
  for (const rowData of rows) {
    const row = worksheet.addRow([
      rowData.plant,
      rowData.vendor,
      rowData.vendorName,
      rowData.material,
      rowData.description,
      rowData.group,
      rowData.uom,
      rowData.sapQty,
      rowData.crmQty,
      rowData.difference,
    ]);

    row.height = 20;

    // Apply basic font, border, and alignment
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 9 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        right: { style: 'thin', color: { argb: 'FFD3D3D3' } },
      };

      // Alignment rules
      if ([1, 2, 4].includes(colNumber)) {
        // Codes (Plant, Vendor, Material)
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if ([8, 9, 10].includes(colNumber)) {
        // Quantities
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0.000'; // High precision for weights and fractional units
      } else {
        // Texts
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });

    // Highlight differences
    const diffCell = row.getCell(10);
    const sapCell = row.getCell(8);
    const crmCell = row.getCell(9);

    if (rowData.difference !== 0) {
      // Discrepancy: Light Red highlight
      const alertFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFC7CE' },
      };
      const alertFont = { name: 'Arial', size: 9, color: { argb: 'FF9C0006' }, bold: true };
      
      diffCell.fill = alertFill;
      diffCell.font = alertFont;
      
      sapCell.fill = alertFill;
      crmCell.fill = alertFill;
    } else {
      // Perfect Match: Light Green highlight for difference
      diffCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFC6EFCE' },
      };
      diffCell.font = { name: 'Arial', size: 9, color: { argb: 'FF006100' } };
    }
  }

  // Adjust Column Widths dynamically
  worksheet.columns.forEach((column) => {
    let maxLength = 0;
    column.eachCell?.((cell) => {
      // Skip the title banner in length calculations
      if ((cell.row as any) === 1) return;
      const valStr = cell.value ? String(cell.value) : '';
      if (valStr.length > maxLength) {
        maxLength = valStr.length;
      }
    });
    column.width = Math.max(maxLength + 3, 10);
  });

  // Specifically adjust wider columns
  worksheet.getColumn(3).width = 28; // Vendor Name
  worksheet.getColumn(5).width = 32; // Material Description
  worksheet.getColumn(6).width = 16; // Material Group
  worksheet.getColumn(10).width = 18; // Difference Column

  return workbook;
}
