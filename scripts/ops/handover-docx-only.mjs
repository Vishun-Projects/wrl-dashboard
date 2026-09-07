#!/usr/bin/env node
/** DOCX-only company share (when Puppeteer Chrome is blocked by policy). */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SHARE_DOCS } from './handover-office-formats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outRoot = path.join(ROOT, 'docs/handover');
const shareDir = path.join(outRoot, '07-Company-Share');
const wordDir = path.join(shareDir, 'Word');
fs.mkdirSync(wordDir, { recursive: true });
fs.mkdirSync(path.join(shareDir, 'Excel'), { recursive: true });

const excelSrc = path.join(outRoot, '04-RBAC/RBAC_MATRIX.xlsx');
const excelDest = path.join(shareDir, 'Excel/RBAC_MATRIX.xlsx');
if (fs.existsSync(excelSrc)) {
  try {
    fs.copyFileSync(excelSrc, excelDest);
  } catch (e) {
    console.warn('excel copy:', e.message);
  }
}

function findPandoc() {
  const candidates = [
    path.join(ROOT, 'scripts/ops/vendor/pandoc-3.11/pandoc.exe'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe') : '',
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return 'pandoc';
}

const PANDOC = findPandoc();
const REF = path.join(ROOT, 'scripts/ops/handover-reference.docx');

function pandocDocx(mdPath, docxPath, title) {
  let md = fs.readFileSync(mdPath, 'utf8');
  md = md.replace(/^#\s+[^\n]+\n+/, '');
  md = md.replace(
    /```mermaid[\s\S]*?```/g,
    '\n\n> Diagram: see Architecture Diagrams PDF or Diagrams folder.\n\n',
  );
  const tmp = path.join(wordDir, `.tmp-${path.basename(docxPath, '.docx')}.md`);
  const safeTitle = title.replace(/"/g, "'");
  fs.writeFileSync(
    tmp,
    `---\ntitle: "${safeTitle}"\nsubtitle: "WRL Portal — Handover Documentation"\nauthor: "Western Refrigeration Pvt. Ltd."\ndate: "${new Date().toISOString().slice(0, 10)}"\n---\n\n${md}`,
  );
  const args = [
    `"${tmp}"`,
    '-o',
    `"${docxPath}"`,
    '--resource-path',
    `"${path.dirname(mdPath)}"`,
    '-f',
    'markdown',
    '-t',
    'docx',
  ];
  if (fs.existsSync(REF)) args.push('--reference-doc', `"${REF}"`);
  execSync(`"${PANDOC}" ${args.join(' ')}`, { stdio: 'pipe' });
  fs.unlinkSync(tmp);
}

for (const doc of SHARE_DOCS) {
  if (doc.skipDocx) continue;
  const mdPath = path.join(outRoot, doc.rel);
  if (!fs.existsSync(mdPath)) {
    console.warn('missing', doc.rel);
    continue;
  }
  const docxPath = path.join(wordDir, `${doc.wordName}.docx`);
  const title = doc.title || doc.pdfName.replace(/_/g, ' ');
  try {
    pandocDocx(mdPath, docxPath, title);
    console.log('DOCX', doc.wordName);
  } catch (e) {
    console.warn('fail', doc.rel, e.message);
  }
}

const guide = path.join(shareDir, 'DELIVERY_GUIDE.md');
if (fs.existsSync(guide)) {
  pandocDocx(guide, path.join(wordDir, '00_Delivery_Guide.docx'), 'Delivery Guide');
  console.log('DOCX 00_Delivery_Guide');
}

const zipPath = path.join(outRoot, 'WRL_Portal_Handover_CompanyShare.zip');
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${shareDir}\\*' -DestinationPath '${zipPath}' -Force"`,
  { stdio: 'pipe' },
);
console.log('ZIP', zipPath);
