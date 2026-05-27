import {
  formatArcpAmount,
  formatArcpQty,
  formatArcpRate,
  type ArcpClaimsTableModel,
} from '@/lib/arcp-claims-table';

export type ArcpClaimsPdfMeta = {
  startDate: string;
  endDate: string;
  dateBasisLabel: string;
  branchLabel: string;
  franchiseeLabel: string;
  callTypeLabel: string;
};

type PdfCell =
  | string
  | {
      content: string;
      colSpan?: number;
      styles?: Record<string, unknown>;
    };

type JsPdfDoc = import('jspdf').jsPDF;

/** jsPDF document size — keep viewer frame in sync with these values. */
export const ARCP_PDF_PAGE_WIDTH_MM = 210;
export const ARCP_PDF_PAGE_HEIGHT_MM = 297;
export const ARCP_PDF_ORIENTATION = 'portrait' as const;
export const ARCP_PDF_FORMAT = 'a4' as const;
export const ARCP_PDF_LOGO_PATH = '/western-head-logo-2025.png';

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];

/** Compact vertical rhythm for statement PDF. */
const PDF_ROW_GAP = 3.2;
const PDF_SECTION_GAP = 5;
const PDF_TABLE_CELL_PAD = 1;
const PDF_TABLE_HEAD_PAD = 1.2;
const PDF_TABLE_MIN_ROW = 4.5;
const PDF_TABLE_NUM_PAD_INNER = 1.2;
const PDF_TABLE_NUM_PAD_RIGHT = 2.5;
const PDF_SUMMARY_VALUE_INSET = 2;

function formatPdfDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statementRef(startDate: string, endDate: string): string {
  return `ARCP-${startDate.replace(/-/g, '')}-${endDate.replace(/-/g, '')}`;
}

const SECTION_HEADER_STYLE = {
  fontStyle: 'bold' as const,
  fontSize: 7,
  textColor: INK,
  cellPadding: { top: 2.5, bottom: 0.5, left: 0, right: 0 },
};

function buildLineItems(model: ArcpClaimsTableModel): PdfCell[][] {
  const body: PdfCell[][] = [];

  for (const row of model.rows) {
    if (row.kind === 'section-header') {
      body.push([
        {
          content: row.serviceDescription.toUpperCase(),
          styles: SECTION_HEADER_STYLE,
        },
        '',
        '',
        '',
        '',
        '',
      ]);
      continue;
    }

    if (row.kind === 'travel') {
      body.push([
        row.serviceDescription,
        formatArcpRate(row.rate),
        '',
        formatArcpAmount(row.amountPayable),
        formatArcpAmount(row.branchApproved),
        formatArcpAmount(row.hoApproved),
      ]);
      continue;
    }

    body.push([
      row.serviceDescriptionSubLabel,
      formatArcpRate(row.rate),
      formatArcpQty(row.qty),
      formatArcpAmount(row.amountPayable),
      formatArcpAmount(row.branchApproved),
      formatArcpAmount(row.hoApproved),
    ]);
  }

  return body;
}

function drawRule(doc: JsPdfDoc, x: number, y: number, width: number): void {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + width, y);
}

function drawSectionLabel(doc: JsPdfDoc, text: string, x: number, y: number): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(text, x, y);
}

function drawMetaRow(
  doc: JsPdfDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number
): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(label, x, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  const valueLines = doc.splitTextToSize(value, width * 0.58) as string[];
  doc.text(valueLines, x + width, y, { align: 'right' });

  return y + Math.max(4, valueLines.length * PDF_ROW_GAP);
}

function drawSummaryBlock(
  doc: JsPdfDoc,
  model: ArcpClaimsTableModel,
  x: number,
  y: number,
  width: number
): number {
  const rows: { label: string; value: string; bold?: boolean }[] = [
    { label: 'Service quantity', value: formatArcpQty(model.totals.qty) || '0' },
    { label: 'HO Approved', value: formatArcpAmount(model.totals.hoApproved) || '0', bold: true },
    { label: 'Branch Approved', value: formatArcpAmount(model.totals.branchApproved) || '0' },
    { label: 'Raised Amount', value: formatArcpAmount(model.totals.amountPayable) || '0' },
  ];

  drawRule(doc, x, y, width);
  let cursor = y + 5;

  for (const row of rows) {
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(row.bold ? 8.5 : 7.5);
    doc.setTextColor(...(row.bold ? INK : MUTED));
    doc.text(row.label, x, cursor);
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setTextColor(...INK);
    doc.text(row.value, x + width - PDF_SUMMARY_VALUE_INSET, cursor, { align: 'right' });
    cursor += 5;
  }

  drawRule(doc, x, cursor + 0.5, width);
  return cursor + 4;
}

function applyTableCellPadding(data: import('jspdf-autotable').CellHookData): void {
  if (data.section !== 'head' && data.section !== 'body') return;

  const isDescription = data.column.index === 0;
  const isLastColumn = data.column.index === 5;
  const top = data.section === 'head' ? 0 : PDF_TABLE_CELL_PAD;
  const bottom = data.section === 'head' ? PDF_TABLE_HEAD_PAD : PDF_TABLE_CELL_PAD;

  data.cell.styles.halign = isDescription ? 'left' : 'right';
  data.cell.styles.cellPadding = {
    top,
    bottom,
    left: isDescription ? 0 : PDF_TABLE_NUM_PAD_INNER,
    right: isDescription ? PDF_TABLE_NUM_PAD_INNER : isLastColumn ? PDF_TABLE_NUM_PAD_RIGHT : PDF_TABLE_NUM_PAD_INNER,
  };
}
function buildTableColumnStyles(contentWidth: number) {
  const fractions = [0.4, 0.1, 0.08, 0.14, 0.14, 0.14];
  const widths: number[] = [];
  let used = 0;

  for (let index = 0; index < fractions.length - 1; index += 1) {
    const width = Math.floor(contentWidth * fractions[index]! * 100) / 100;
    widths.push(width);
    used += width;
  }

  widths.push(Math.round((contentWidth - used) * 100) / 100);

  return {
    0: { cellWidth: widths[0], halign: 'left' as const },
    1: { cellWidth: widths[1], halign: 'right' as const },
    2: { cellWidth: widths[2], halign: 'right' as const },
    3: { cellWidth: widths[3], halign: 'right' as const },
    4: { cellWidth: widths[4], halign: 'right' as const },
    5: { cellWidth: widths[5], halign: 'right' as const },
  };
}

function buildTableHeadRow() {
  return [
    [
      { content: 'Description', styles: { halign: 'left' as const } },
      { content: 'Rate', styles: { halign: 'right' as const } },
      { content: 'Qty', styles: { halign: 'right' as const } },
      { content: 'Payable', styles: { halign: 'right' as const } },
      { content: 'Branch', styles: { halign: 'right' as const } },
      { content: 'HO', styles: { halign: 'right' as const } },
    ],
  ];
}

type PdfLogoAsset = {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
};

async function loadPdfLogo(path = ARCP_PDF_LOGO_PATH): Promise<PdfLogoAsset | null> {
  if (typeof window === 'undefined') return null;

  try {
    const response = await fetch(path);
    if (!response.ok) return null;

    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode logo image'));
      el.src = dataUrl;
    });

    return {
      dataUrl,
      widthPx: image.naturalWidth,
      heightPx: image.naturalHeight,
    };
  } catch {
    return null;
  }
}

function drawPdfLogo(
  doc: JsPdfDoc,
  logo: PdfLogoAsset,
  x: number,
  y: number,
  maxWidthMm: number,
  maxHeightMm: number
): { widthMm: number; heightMm: number } {
  const aspect = logo.widthPx / logo.heightPx;
  let widthMm = maxWidthMm;
  let heightMm = widthMm / aspect;

  if (heightMm > maxHeightMm) {
    heightMm = maxHeightMm;
    widthMm = heightMm * aspect;
  }

  doc.addImage(logo.dataUrl, 'PNG', x, y, widthMm, heightMm);
  return { widthMm, heightMm };
}

async function createArcpClaimsPdfDoc(model: ArcpClaimsTableModel, meta: ArcpClaimsPdfMeta) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({
    orientation: ARCP_PDF_ORIENTATION,
    unit: 'mm',
    format: ARCP_PDF_FORMAT,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const contentWidth = pageWidth - marginX * 2;
  const columnStyles = buildTableColumnStyles(contentWidth);
  const headerTop = 12;
  let cursorY = headerTop;
  const logo = await loadPdfLogo();

  if (logo) {
    const { heightMm } = drawPdfLogo(doc, logo, marginX, headerTop, 52, 14);
    cursorY = headerTop + heightMm + 2;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text('WRL', marginX, headerTop + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text('ARCP Claims', marginX, headerTop + 8);
    cursorY = headerTop + 12;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text('STATEMENT', pageWidth - marginX, headerTop + 4, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`Ref. ${statementRef(meta.startDate, meta.endDate)}`, pageWidth - marginX, headerTop + 9, {
    align: 'right',
  });

  const generatedOn = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  doc.text(`Date ${generatedOn}`, pageWidth - marginX, headerTop + 13, { align: 'right' });

  cursorY = Math.max(cursorY, headerTop + 16) + 2;
  drawRule(doc, marginX, cursorY, contentWidth);
  cursorY += 6;

  const sectionTop = cursorY;
  const halfWidth = contentWidth / 2 - 4;
  const leftX = marginX;
  const rightX = marginX + contentWidth / 2 + 4;

  drawSectionLabel(doc, 'SERVICE CENTRE', leftX, sectionTop);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  const franchiseeLines = doc.splitTextToSize(meta.franchiseeLabel, halfWidth) as string[];
  doc.text(franchiseeLines, leftX, sectionTop + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const branchY = sectionTop + 4 + franchiseeLines.length * 3.5 + 1;
  doc.text(`Branch: ${meta.branchLabel}`, leftX, branchY);
  const leftBottom = branchY + 2.5;

  drawSectionLabel(doc, 'PERIOD', rightX, sectionTop);
  let rightBottom = drawMetaRow(
    doc,
    'Billing period',
    `${formatPdfDate(meta.startDate)} – ${formatPdfDate(meta.endDate)}`,
    rightX,
    sectionTop + 4,
    halfWidth
  );
  // rightBottom = drawMetaRow(doc, 'Date basis', meta.dateBasisLabel, rightX, rightBottom + 1, halfWidth);
  // rightBottom = drawMetaRow(doc, 'Call type', meta.callTypeLabel, rightX, rightBottom + 1, halfWidth);

  cursorY = Math.max(leftBottom, rightBottom) + PDF_SECTION_GAP;
  drawRule(doc, marginX, cursorY, contentWidth);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    tableWidth: contentWidth,
    head: buildTableHeadRow(),
    body: buildLineItems(model),
    margin: { left: marginX, right: marginX },
    theme: 'plain',
    showHead: 'everyPage',
    styles: {
      fontSize: 7.5,
      halign: 'right',
      cellPadding: {
        top: PDF_TABLE_CELL_PAD,
        bottom: PDF_TABLE_CELL_PAD,
        left: PDF_TABLE_NUM_PAD_INNER,
        right: PDF_TABLE_NUM_PAD_INNER,
      },
      minCellHeight: PDF_TABLE_MIN_ROW,
      textColor: INK,
      lineColor: LINE,
      lineWidth: { bottom: 0.12, top: 0, left: 0, right: 0 },
      fillColor: [255, 255, 255],
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: MUTED,
      fontStyle: 'bold',
      fontSize: 6.5,
      halign: 'right',
      cellPadding: {
        top: 0,
        bottom: PDF_TABLE_HEAD_PAD,
        left: PDF_TABLE_NUM_PAD_INNER,
        right: PDF_TABLE_NUM_PAD_INNER,
      },
      minCellHeight: PDF_TABLE_MIN_ROW,
      lineWidth: { bottom: 0.35, top: 0, left: 0, right: 0 },
      lineColor: INK,
    },
    columnStyles,
    didParseCell: applyTableCellPadding as import('jspdf-autotable').CellHook,
  });

  const tableEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const summaryWidth = 78;
  const summaryX = pageWidth - marginX - summaryWidth;
  let summaryY = tableEndY + 6;

  if (summaryY > pageHeight - 30) {
    doc.addPage();
    summaryY = 16;
  }

  drawSummaryBlock(doc, model, summaryX, summaryY, summaryWidth);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('All amounts in INR.', marginX, pageHeight - 10);
    doc.text(`${page} / ${pageCount}`, pageWidth - marginX, pageHeight - 10, { align: 'right' });
  }

  return doc;
}

export function buildArcpClaimsPdfFileName(startDate: string, endDate: string): string {
  return `ARCP_Claims_${startDate}_${endDate}.pdf`;
}

export async function buildArcpClaimsPdfBlob(
  model: ArcpClaimsTableModel,
  meta: ArcpClaimsPdfMeta,
  fileName: string
): Promise<{ blob: Blob; fileName: string }> {
  const doc = await createArcpClaimsPdfDoc(model, meta);
  return {
    blob: doc.output('blob'),
    fileName,
  };
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadArcpClaimsPdf(
  model: ArcpClaimsTableModel,
  meta: ArcpClaimsPdfMeta,
  fileName: string
): Promise<void> {
  const { blob } = await buildArcpClaimsPdfBlob(model, meta, fileName);
  downloadPdfBlob(blob, fileName);
}
