/**
 * HTML document shell for consistent handover PDF/DOCX output.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { HANDOVER_PROD_URL } from './handover-constants.mjs';

export const DIAGRAM_CATALOG = [
  { file: '01-system-workflow.png', title: 'System workflow overview' },
  { file: '02-1-auth-flow.png', title: 'Authentication flow' },
  { file: '02-2-mis-report-load.png', title: 'MIS report load' },
  { file: '02-3-mis-email-digest.png', title: 'MIS email digest' },
  { file: '02-4-manual-email-compose.png', title: 'Manual email compose' },
  { file: '02-5-major-repair-alert.png', title: 'Major repair alert' },
  { file: '02-6-crm-postgres-sync.png', title: 'CRM → Postgres sync' },
  { file: '02-7-arcp-hybrid-load.png', title: 'ARCP hybrid load' },
  { file: '02-8-cancelled-calls-report.png', title: 'Cancelled calls report' },
  { file: '02-9-athena-reconciliation.png', title: 'Athena reconciliation' },
  { file: '02-10-cancelled-call-digest.png', title: 'Cancelled call digest' },
  { file: '02-11-subcontractor-stock.png', title: 'Subcontractor stock' },
  { file: '02-12-attendance-activity.png', title: 'Attendance / service call activity' },
  { file: '06-deployment-infrastructure.png', title: 'Deployment infrastructure' },
  { file: '07-etl-data-flow.png', title: 'ETL data flow' },
  { file: '08-background-jobs-overview.png', title: 'Background jobs overview' },
  { file: '08-background-jobs-cron-gate.png', title: 'Background jobs cron gate' },
  { file: '09-key-tables-erd.png', title: 'Key tables ERD' },
  { file: '10-rbac-decision-flow.png', title: 'RBAC decision flow' },
  { file: '11-failure-degradation-paths.png', title: 'Failure and degradation paths' },
];

export const DOC_META = {
  org: 'Western Refrigeration Pvt. Ltd.',
  product: 'WRL Portal',
  version: '1.0 draft',
  confidential: 'Internal — Handover Documentation',
};

export const PDF_HEADER = `<div style="font-family:Segoe UI,Calibri,sans-serif;font-size:8px;width:100%;padding:0 18mm;color:#94a3b8;display:flex;justify-content:space-between;">
  <span>WRL Portal — Handover</span>
  <span>Confidential</span>
</div>`;

export const PDF_FOOTER = `<div style="font-family:Segoe UI,Calibri,sans-serif;font-size:8px;width:100%;padding:0 18mm;color:#94a3b8;display:flex;justify-content:space-between;">
  <span>Generated ${new Date().toISOString().slice(0, 10)}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;

export function coverPageHtml(title, subtitle = '') {
  return `<section class="cover-page">
  <div class="org">${DOC_META.org}</div>
  <h1>${title}</h1>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  <div class="meta">
    <strong>Product:</strong> ${DOC_META.product}<br>
    <strong>Version:</strong> ${DOC_META.version}<br>
    <strong>Date:</strong> ${new Date().toISOString().slice(0, 10)}<br>
    <strong>Production:</strong> ${HANDOVER_PROD_URL}<br>
    <em>${DOC_META.confidential}</em>
  </div>
</section>`;
}

export function docHeaderBar(title) {
  return `<div class="doc-header-bar"><strong>${DOC_META.product}</strong> — ${title} &nbsp;|&nbsp; ${DOC_META.version} &nbsp;|&nbsp; ${new Date().toISOString().slice(0, 10)}</div>`;
}

/** @returns {'wide'|'tall'|'normal'} */
export async function imageLayoutClass(absPath) {
  try {
    const { width, height } = await sharp(absPath).metadata();
    if (!width || !height) return 'normal';
    const ratio = width / height;
    if (ratio > 1.4) return 'wide';
    if (ratio < 0.75) return 'tall';
    return 'normal';
  } catch {
    return 'normal';
  }
}

export async function buildDiagramsHtml(outRoot) {
  const diagramsDir = path.join(outRoot, '03-Technical/diagrams');
  const sections = [];

  for (let i = 0; i < DIAGRAM_CATALOG.length; i++) {
    const { file, title } = DIAGRAM_CATALOG[i];
    const abs = path.join(diagramsDir, file);
    if (!fs.existsSync(abs)) continue;
    const layout = await imageLayoutClass(abs);
    const b64 = fs.readFileSync(abs).toString('base64');
    sections.push(`<section class="diagram-page layout-${layout}">
  <h2><span class="diagram-num">${String(i + 1).padStart(2, '0')}.</span> ${title}</h2>
  <div class="diagram-frame">
    <img src="data:image/png;base64,${b64}" alt="${title}" />
  </div>
  <p class="diagram-caption">${file}</p>
</section>`);
  }

  const toc = DIAGRAM_CATALOG.map((d, i) => {
    if (!fs.existsSync(path.join(diagramsDir, d.file))) return '';
    return `<li>${String(i + 1).padStart(2, '0')}. ${d.title}</li>`;
  }).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WRL Portal — Architecture Diagrams</title>
</head>
<body>
${coverPageHtml('Architecture Diagrams', 'System flows, deployment, RBAC, and background jobs')}
<section class="toc">
  <h2>Contents</h2>
  <ol>${toc}</ol>
</section>
${sections.join('\n')}
</body>
</html>`;
}

export function wrapHtmlDocument(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body>
${coverPageHtml(title)}
${docHeaderBar(title)}
${bodyHtml}
</body>
</html>`;
}

export const STANDARD_PDF_OPTIONS = {
  format: 'A4',
  margin: { top: '28mm', right: '18mm', bottom: '22mm', left: '18mm' },
  printBackground: true,
  displayHeaderFooter: true,
};
