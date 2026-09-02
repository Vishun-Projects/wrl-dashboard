#!/usr/bin/env node
/**
 * Export all Mermaid diagrams from docs/ARCHITECTURE.md as PNG images.
 * Output: docs/diagrams/*.png
 *
 * Usage:
 *   node scripts/ops/export-mermaid-diagrams.mjs
 *
 * Requires: npx @mermaid-js/mermaid-cli (installed on first run via npx)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..', '..');
const SRC = path.join(ROOT, 'docs', 'ARCHITECTURE.md');
const OUT_DIR = path.join(ROOT, 'docs', 'diagrams');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// Map section headings to short diagram names
const DIAGRAM_NAMES = [
  '01-system-workflow',
  '02-1-auth-flow',
  '02-2-mis-report-load',
  '02-3-mis-email-digest',
  '02-4-manual-email-compose',
  '02-5-major-repair-alert',
  '02-6-crm-postgres-sync',
  '02-7-arcp-hybrid-load',
  '02-8-cancelled-calls-report',
  '02-9-athena-reconciliation',
  '02-10-cancelled-call-digest',
  '02-11-subcontractor-stock',
  '02-12-attendance-activity',
  '06-deployment-infrastructure',
  '07-etl-data-flow',
  '08-background-jobs-overview',
  '08-background-jobs-cron-gate',
  '09-key-tables-erd',
  '10-rbac-decision-flow',
  '11-failure-degradation-paths',
];

// Extract all ```mermaid ... ``` blocks from the markdown
const md = readFileSync(SRC, 'utf8');
const blocks = [];
const re = /```mermaid\n([\s\S]*?)```/g;
let m;
while ((m = re.exec(md)) !== null) {
  blocks.push(m[1]);
}

console.log(`Found ${blocks.length} Mermaid diagram(s) in ${SRC}`);

if (blocks.length !== DIAGRAM_NAMES.length) {
  console.warn(
    `WARNING: expected ${DIAGRAM_NAMES.length} names but found ${blocks.length} blocks. ` +
    `Extra blocks will be named diagram-NN.`
  );
}

// Write .mmd files
const mmdFiles = blocks.map((src, i) => {
  const name = DIAGRAM_NAMES[i] ?? `diagram-${String(i + 1).padStart(2, '0')}`;
  const mmdPath = path.join(OUT_DIR, `${name}.mmd`);
  writeFileSync(mmdPath, src, 'utf8');
  return { name, mmdPath };
});

// Render each with mmdc
const failed = [];
for (const { name, mmdPath } of mmdFiles) {
  const pngPath = path.join(OUT_DIR, `${name}.png`);
  const cmd = [
    'npx', '--yes', '@mermaid-js/mermaid-cli',
    '-i', JSON.stringify(mmdPath),
    '-o', JSON.stringify(pngPath),
    '--width', '1800',
    '--height', '1200',
    '--backgroundColor', 'white',
    '--quiet',
  ].join(' ');

  process.stdout.write(`  Rendering ${name}.png ... `);
  try {
    execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('OK');
  } catch (err) {
    console.log('FAILED');
    failed.push({ name, err: err.stderr?.toString().slice(0, 300) });
  }
}

if (failed.length) {
  console.error(`\n${failed.length} diagram(s) failed:`);
  for (const { name, err } of failed) {
    console.error(`  ${name}: ${err}`);
  }
  process.exit(1);
} else {
  console.log(`\nAll ${blocks.length} diagrams exported to ${OUT_DIR}`);
}
