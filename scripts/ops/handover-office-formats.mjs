/**
 * Convert handover markdown → DOCX + PDF for company share.
 * Output: <outRoot>/07-Company-Share/{PDF,Word,Diagrams,Excel}
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { marked } from 'marked';
import HTMLtoDOCX from 'html-to-docx';
import puppeteer from 'puppeteer';

import {
  PDF_HEADER,
  PDF_FOOTER,
  STANDARD_PDF_OPTIONS,
  coverPageHtml,
  docHeaderBar,
  buildDiagramsHtml,
  DIAGRAM_CATALOG,
} from './handover-document-template.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PDF_CSS = path.join(SCRIPT_DIR, 'handover-pdf.css');
const PANDOC_REF_DOC = path.join(SCRIPT_DIR, 'handover-reference.docx');

/** Resolve pandoc binary (winget installs to %LOCALAPPDATA%\\Pandoc on Windows). */
function findPandoc() {
  if (process.env.PANDOC_PATH && fs.existsSync(process.env.PANDOC_PATH)) {
    return process.env.PANDOC_PATH;
  }
  const candidates = [];
  candidates.push(path.join(SCRIPT_DIR, 'vendor/pandoc-3.11/pandoc.exe'));
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe'));
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'));
  }
  candidates.push('C:/Program Files/Pandoc/pandoc.exe');
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  try {
    execSync('pandoc --version', { stdio: 'pipe' });
    return 'pandoc';
  } catch {
    return null;
  }
}

const PANDOC_BIN = findPandoc();

export { DIAGRAM_CATALOG };

/** @type {{ rel: string; pdfName: string; wordName: string; audience: string; title?: string; skipDocx?: boolean; skipCover?: boolean }[]} */
export const SHARE_DOCS = [
  { rel: '00-Index/DOCUMENT_INDEX.md', pdfName: '00_Document_Index', wordName: '00_Document_Index', audience: 'all', title: 'Document Index' },
  { rel: '00-Index/CLOSURE_SUMMARY.md', pdfName: '00_Closure_Summary', wordName: '00_Closure_Summary', audience: 'all', title: 'Closure Summary' },
  { rel: '01-Business/BRD_WRL_Portal.md', pdfName: '01_BRD_WRL_Portal', wordName: '01_BRD_WRL_Portal', audience: 'business', title: 'Business Requirements Document' },
  { rel: '01-Business/SCOPE_SUMMARY.md', pdfName: '01_Scope_Summary', wordName: '01_Scope_Summary', audience: 'business', title: 'Scope Summary' },
  { rel: '02-Functional/FMS_Functional_Module_Spec.md', pdfName: '02_Functional_Module_Spec', wordName: '02_Functional_Module_Spec', audience: 'functional', title: 'Functional Module Specification' },
  { rel: '02-Functional/ADMIN_USER_GUIDE.md', pdfName: '02_Admin_User_Guide', wordName: '02_Admin_User_Guide', audience: 'functional', title: 'Admin & User Guide' },
  { rel: '03-Technical/DIAGRAMS_GUIDE.md', pdfName: '03_Architecture_Diagrams', wordName: '03_Architecture_Diagrams', audience: 'technical', title: 'Architecture Diagrams', skipDocx: true, diagramsPdf: true },
  { rel: '03-Technical/ARCHITECTURE.md', pdfName: '03_Architecture_Full', wordName: '03_Architecture_Full', audience: 'technical', title: 'System Architecture' },
  { rel: '03-Technical/CODEBASE_STRUCTURE.md', pdfName: '03_Codebase_Structure', wordName: '03_Codebase_Structure', audience: 'technical', title: 'Codebase Structure' },
  { rel: '03-Technical/API_REFERENCE.md', pdfName: '03_API_Reference', wordName: '03_API_Reference', audience: 'technical', title: 'API Reference' },
  { rel: '03-Technical/GIT_AND_RELEASE.md', pdfName: '03_Git_and_Release', wordName: '03_Git_and_Release', audience: 'technical', title: 'Git & Release' },
  { rel: '04-RBAC/RBAC_DECISION_FLOW.md', pdfName: '04_RBAC_Decision_Flow', wordName: '04_RBAC_Decision_Flow', audience: 'rbac', title: 'RBAC Decision Flow' },
  { rel: '04-RBAC/ROLES_SNAPSHOT.md', pdfName: '04_Roles_Snapshot', wordName: '04_Roles_Snapshot', audience: 'rbac', title: 'Portal Roles Snapshot (live DB)' },
  { rel: '05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md', pdfName: '05_Known_Issues', wordName: '05_Known_Issues', audience: 'ops', title: 'Known Issues & Limitations' },
  { rel: '05-Operations/PROD_READ_SOURCE.md', pdfName: '05_Prod_Read_Source', wordName: '05_Prod_Read_Source', audience: 'ops', title: 'Production Read Source' },
  { rel: '05-Operations/MAIL_SCHEDULE.md', pdfName: '05_Mail_Schedule', wordName: '05_Mail_Schedule', audience: 'ops', title: 'Mail Schedule' },
  { rel: '05-Operations/SYNC_ENTRY_POINTS.md', pdfName: '05_Sync_Entry_Points', wordName: '05_Sync_Entry_Points', audience: 'ops', title: 'Sync Entry Points' },
  { rel: '05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md', pdfName: '05_VPS_Env_Checklist', wordName: '05_VPS_Env_Checklist', audience: 'ops', title: 'VPS Environment Checklist' },
  { rel: '06-Delivery/SYSTEM_VERIFICATION.md', pdfName: '06_System_Verification', wordName: '06_System_Verification', audience: 'delivery', title: 'System Verification' },
  { rel: '06-Delivery/DELIVERY_STATEMENT.md', pdfName: '06_Delivery_Statement', wordName: '06_Delivery_Statement', audience: 'delivery', title: 'Delivery Statement' },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Strip mermaid; embed images as base64. Markdown only — no HTML prefix (tables break if mixed). */
function preprocessMarkdownBody(md, baseDir, { embedImagesAsBase64 = true, stripTitle = false } = {}) {
  let out = md;
  if (stripTitle) {
    out = out.replace(/^#\s+[^\n]+\n+/, '');
  }
  out = out.replace(/```mermaid[\s\S]*?```/g, '\n\n> **Diagram:** See *Architecture Diagrams* PDF (`03_Architecture_Diagrams.pdf`) or `07-Company-Share/Diagrams/`.\n\n');
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    if (src.startsWith('data:')) return `![${alt}](${src})`;
    if (src.startsWith('http')) return `![${alt}](${src})`;
    const abs = path.resolve(baseDir, src);
    if (!fs.existsSync(abs)) return `![${alt}](${src})`;
    if (embedImagesAsBase64) {
      const ext = path.extname(abs).slice(1).toLowerCase() || 'png';
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      const b64 = fs.readFileSync(abs).toString('base64');
      return `![${alt}](data:image/${mime};base64,${b64})`;
    }
    return `![${alt}](${pathToFileURL(abs).href})`;
  });
  return out;
}

/** @deprecated use preprocessMarkdownBody — kept for docx fallback path */
function preprocessMarkdown(md, baseDir, { embedImagesAsBase64 = true, title = '', withCover = true } = {}) {
  const out = preprocessMarkdownBody(md, baseDir, { embedImagesAsBase64, stripTitle: Boolean(withCover && title) });
  const prefix = [];
  if (withCover && title) prefix.push(coverPageHtml(title));
  if (title) prefix.push(docHeaderBar(title));
  if (prefix.length) return `${prefix.join('\n')}\n\n${out}`;
  return out;
}

/** Pandoc path: YAML metadata + relative images (--resource-path). */
function preprocessForPandoc(md, title) {
  let out = md.replace(/^#\s+[^\n]+\n+/, '');
  out = out.replace(/```mermaid[\s\S]*?```/g, '\n\n> **Diagram:** See *Architecture Diagrams* PDF (`03_Architecture_Diagrams.pdf`) or `07-Company-Share/Diagrams/`.\n\n');
  const safeTitle = title.replace(/"/g, "'");
  return `---
title: "${safeTitle}"
subtitle: "WRL Portal — Handover Documentation"
author: "Western Refrigeration Pvt. Ltd."
date: "${new Date().toISOString().slice(0, 10)}"
---

${out}`;
}

async function mdToDocx(mdPath, docxPath, title = '') {
  const baseDir = path.dirname(mdPath);
  const tmpMd = path.join(path.dirname(docxPath), `.tmp-pandoc-${path.basename(mdPath)}`);

  if (PANDOC_BIN && fs.existsSync(PANDOC_REF_DOC)) {
    fs.writeFileSync(tmpMd, preprocessForPandoc(fs.readFileSync(mdPath, 'utf8'), title));
    try {
      execSync(
        `"${PANDOC_BIN}" "${tmpMd}" -o "${docxPath}" --reference-doc="${PANDOC_REF_DOC}" --resource-path="${baseDir}" --from=markdown+yaml_metadata_block`,
        { stdio: 'pipe', windowsHide: true },
      );
      return;
    } catch (e) {
      console.warn(`  Pandoc DOCX failed (${title}), using html-to-docx fallback:`, e.stderr?.toString() || e.message);
    } finally {
      if (fs.existsSync(tmpMd)) fs.unlinkSync(tmpMd);
    }
  }

  const md = preprocessMarkdown(fs.readFileSync(mdPath, 'utf8'), baseDir, { embedImagesAsBase64: true, title, withCover: false });
  const html = marked.parse(md, { gfm: true });
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  const buf = await HTMLtoDOCX(wrapped, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
    title,
  });
  fs.writeFileSync(docxPath, buf);
}

function pdfOptions() {
  return {
    ...STANDARD_PDF_OPTIONS,
    headerTemplate: PDF_HEADER,
    footerTemplate: PDF_FOOTER,
  };
}

function buildPdfHtml(md, baseDir, title = '', { withCover = true } = {}) {
  const bodyMd = preprocessMarkdownBody(md, baseDir, { embedImagesAsBase64: true, stripTitle: Boolean(withCover && title) });
  const bodyHtml = marked.parse(bodyMd, { gfm: true });
  const parts = [];
  if (withCover && title) parts.push(coverPageHtml(title));
  if (title) parts.push(docHeaderBar(title));
  parts.push(`<main class="doc-body">${bodyHtml}</main>`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title || 'WRL Portal'}</title>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}

async function mdToPdfFile(mdPath, pdfPath, browser, title = '') {
  const baseDir = path.dirname(mdPath);
  const md = fs.readFileSync(mdPath, 'utf8');
  const html = buildPdfHtml(md, baseDir, title, { withCover: true });
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    if (fs.existsSync(PDF_CSS)) {
      await page.addStyleTag({ path: PDF_CSS });
    }
    await page.pdf({ path: pdfPath, ...pdfOptions() });
  } finally {
    await page.close();
  }
}

/** Dedicated diagrams PDF — one diagram per page, smart scaling, cover + TOC. */
async function diagramsToPdf(outRoot, pdfPath, browser) {
  const html = await buildDiagramsHtml(outRoot);
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ path: PDF_CSS });
    await page.pdf({ path: pdfPath, ...pdfOptions() });
  } finally {
    await page.close();
  }
}

export function generateDiagramsGuide(outRoot) {
  const diagramsSrc = path.join(outRoot, '03-Technical/diagrams');
  const mdPath = path.join(outRoot, '03-Technical/DIAGRAMS_GUIDE.md');
  const lines = [
    '# WRL Portal — Architecture Diagrams',
    '',
    '> **Status:** Ready — one diagram per PDF page; wide diagrams use landscape. For full-res labels open `07-Company-Share/Diagrams/*.png`.',
    '',
    'Visual reference for stakeholders and IT.',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
  ];
  for (const { file, title } of DIAGRAM_CATALOG) {
    const src = path.join(diagramsSrc, file);
    if (!fs.existsSync(src)) continue;
    lines.push(`## ${title}`, '', `![${title}](diagrams/${file})`, '', '---', '');
  }
  fs.writeFileSync(mdPath, lines.join('\n'));
  return mdPath;
}

function copyDiagramsToShare(outRoot, shareDir) {
  const srcDir = path.join(outRoot, '03-Technical/diagrams');
  const destDir = path.join(shareDir, 'Diagrams');
  ensureDir(destDir);
  if (!fs.existsSync(srcDir)) return;
  for (const { file } of DIAGRAM_CATALOG) {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, file));
  }
}

function copyExcelToShare(outRoot, shareDir) {
  const src = path.join(outRoot, '04-RBAC/RBAC_MATRIX.xlsx');
  const destDir = path.join(shareDir, 'Excel');
  const dest = path.join(destDir, 'RBAC_MATRIX.xlsx');
  ensureDir(destDir);
  if (!fs.existsSync(src)) return;
  try {
    fs.copyFileSync(src, dest);
  } catch (_e) {
    console.warn('  Excel copy skipped (file locked?):', dest);
  }
}

function copyDeliveryGuide(outRoot, shareDir) {
  for (const name of ['DELIVERY_GUIDE.md', 'README.txt']) {
    const src = path.join(outRoot, '07-Company-Share', name);
    const dest = path.join(shareDir, name);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dest);
      } catch (e) {
        console.warn(`  delivery guide copy skipped: ${name}`, e.message);
      }
    }
  }
}

function tryZipShare(shareDir) {
  const zipPath = path.join(path.dirname(shareDir), 'WRL_Portal_Handover_CompanyShare.zip');
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${shareDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
        { stdio: 'pipe' },
      );
      return zipPath;
    }
    execSync(`cd "${path.dirname(shareDir)}" && zip -r "WRL_Portal_Handover_CompanyShare.zip" "${path.basename(shareDir)}"`, {
      stdio: 'pipe',
    });
    return zipPath;
  } catch (e) {
    console.warn('zip skipped:', e.message);
    return null;
  }
}

/**
 * @param {string} outRoot handover root (docs/handover or OneDrive WRLD)
 */
export async function exportCompanyShareFormats(outRoot) {
  if (PANDOC_BIN) {
    console.log(`  Pandoc ${execSync(`"${PANDOC_BIN}" --version`, { encoding: 'utf8' }).split('\n')[0]}`);
  } else {
    console.warn('  Pandoc not found — Word output uses html-to-docx fallback');
  }
  generateDiagramsGuide(outRoot);

  const shareDir = path.join(outRoot, '07-Company-Share');
  const pdfDir = path.join(shareDir, 'PDF');
  const wordDir = path.join(shareDir, 'Word');
  ensureDir(pdfDir);
  ensureDir(wordDir);

  copyDiagramsToShare(outRoot, shareDir);
  copyExcelToShare(outRoot, shareDir);
  copyDeliveryGuide(outRoot, shareDir);

  const results = { pdf: [], docx: [], errors: [] };

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const doc of SHARE_DOCS) {
      const mdPath = path.join(outRoot, doc.rel);
      if (!fs.existsSync(mdPath)) {
        results.errors.push(`missing: ${doc.rel}`);
        continue;
      }
      const pdfPath = path.join(pdfDir, `${doc.pdfName}.pdf`);
      const docxPath = path.join(wordDir, `${doc.wordName}.docx`);
      const title = doc.title || doc.pdfName.replace(/_/g, ' ');
      try {
        if (doc.diagramsPdf) {
          await diagramsToPdf(outRoot, pdfPath, browser);
        } else {
          await mdToPdfFile(mdPath, pdfPath, browser, title);
        }
        results.pdf.push(pdfPath);
        console.log(`  PDF  ${doc.pdfName}.pdf`);
      } catch (e) {
        results.errors.push(`pdf ${doc.rel}: ${e.message}`);
        console.warn(`  PDF failed ${doc.rel}:`, e.message);
      }
      if (!doc.skipDocx) {
        try {
          await mdToDocx(mdPath, docxPath, title);
          results.docx.push(docxPath);
          console.log(`  DOCX ${doc.wordName}.docx`);
        } catch (e) {
          results.errors.push(`docx ${doc.rel}: ${e.message}`);
          console.warn(`  DOCX failed ${doc.rel}:`, e.message);
        }
      }
    }

    const guideMd = path.join(shareDir, 'DELIVERY_GUIDE.md');
    try {
      await mdToPdfFile(guideMd, path.join(pdfDir, '00_Delivery_Guide.pdf'), browser, 'Delivery Guide');
      await mdToDocx(guideMd, path.join(wordDir, '00_Delivery_Guide.docx'), 'Delivery Guide');
      console.log('  PDF  00_Delivery_Guide.pdf');
    } catch (e) {
      console.warn('  delivery guide export:', e.message);
    }
  } finally {
    await browser.close();
  }

  const zip = tryZipShare(shareDir);
  if (zip) console.log(`  ZIP  ${zip}`);

  return { shareDir, zip, ...results };
}
