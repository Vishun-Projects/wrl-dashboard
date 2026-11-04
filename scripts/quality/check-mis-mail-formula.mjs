#!/usr/bin/env node
/**
 * Hard lock: MIS mail body/open Excel stay on one formula.
 * Fails pre-commit / pre-push if someone reintroduces the Nov 2026 dual paths.
 *
 * Formula: CRM solved/cancelled + open Excel overlay; Regional = Branch rollup;
 * Open Calls Excel = same WRL-mapped opens; SAP code (1127) → WRL BRANCH.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.error(`check:mis-mail-formula FAIL — missing ${rel}`);
    process.exit(1);
  }
  return readFileSync(path, 'utf8');
}

function mustInclude(file, text, why) {
  if (!file.includes(text)) {
    console.error(`check:mis-mail-formula FAIL — required text missing:\n  ${why}\n  need: ${JSON.stringify(text)}`);
    process.exit(1);
  }
}

function mustNotInclude(file, pattern, why) {
  const re = typeof pattern === 'string' ? null : pattern;
  const hit = re ? re.test(file) : file.includes(pattern);
  if (hit) {
    console.error(`check:mis-mail-formula FAIL — forbidden pattern:\n  ${why}\n  found: ${pattern}`);
    process.exit(1);
  }
}

const compose = read('src/modules/mis-email/services/compose-digest.ts');
const mailBasis = read('src/modules/mis-email/services/mail-basis.ts');
const excel = read('src/modules/mis/services/bd-mis-excel-export.ts');
const unified = read('src/modules/mis/services/mis-unified-metrics.ts');
const plant = read('src/modules/mis/services/plant-to-wrl-branch.ts');
const body = read('src/modules/mis-email/services/body-sections.ts');

// --- compose: one body path ---
mustNotInclude(compose, 'fullTraceRows', 'compose must not switch body to full-trace when Excel is on');
mustNotInclude(
  compose,
  'overlayRegionalOpenFromExcelRows',
  'compose must not build Regional from a second overlay path'
);
mustNotInclude(
  compose,
  'buildMisEmailRegionalAndBranchRowsFromTrace',
  'compose must not use FromTrace rows for the mail body'
);
mustNotInclude(
  compose,
  'buildMisEmailKeyAccountRowsFromTrace',
  'compose must not use FromTrace for key-account body'
);
mustNotInclude(compose, 'Unassigned', 'do not invent an Unassigned branch bucket for opens');
mustNotInclude(
  compose,
  /openTraceRows\?\.length/,
  'open overlay must not be optional (CRM-open fallback)'
);
mustInclude(
  compose,
  'refusing CRM-open fallback',
  'compose must hard-fail when open corpus is missing'
);
mustInclude(
  compose,
  'rollupVisibleBranchesToRegional',
  'Regional body must be Branch rollup'
);
mustInclude(
  compose,
  'openTraceRows: needsOpenOverlay',
  'preview and send must pass the same open overlay'
);

// --- overlay: drop unmapped, no Unassigned ---
mustNotInclude(
  mailBasis,
  'MIS_UNASSIGNED_BRANCH_LABEL',
  'mail-basis must not reintroduce Unassigned open bucket'
);
mustNotInclude(mailBasis, '— Unassigned', 'mail-basis must not label unmapped plants Unassigned');
mustInclude(
  mailBasis,
  'if (!resolved) continue',
  'unmapped plants must be omitted from branch overlay (same as 2559 mail)'
);

// --- Excel open = body opens ---
mustInclude(
  excel,
  'filterTraceRowsForMailBodyOpenExport',
  'Open Calls Excel must use mail-body WRL-mapped opens'
);
mustInclude(
  unified,
  'filterTraceRowsForMailBodyOpenExport',
  'unified metrics must expose mail-body open filter'
);

// --- SAP code → WRL BRANCH ---
mustInclude(
  plant,
  'findSapCodeTopLevelBranch',
  '1127/1150-style labels must prefer WRL BRANCH over franchisee officeId'
);
mustInclude(
  plant,
  'CLIENT_IMPORT_BRANCH_BY_OFFICE_ID',
  'SAP code map must stay aligned with client-import branch codes'
);

// --- body-sections: empty overlay must not fall back to CRM opens ---
mustInclude(
  body,
  'branchPerformanceRows !== undefined',
  'empty overlaid branch list must not fall back to CRM opens'
);
mustInclude(
  body,
  'rollupVisibleBranchesToRegional',
  'body-sections must export/use Branch→Regional rollup'
);

console.log('check:mis-mail-formula OK');
