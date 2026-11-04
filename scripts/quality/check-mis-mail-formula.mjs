#!/usr/bin/env node
/**
 * Hard lock: MIS mail body formula (Nov 2026 corrected).
 *
 * Regional: account-merge solved/cancelled + open Excel overlay (zone).
 * Branch: CRM top-level solved/cancelled + open Excel overlay (WRL plant map).
 * Never full-trace body, never CRM-open fallback, never Unassigned bucket.
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
const plant = read('src/modules/mis/services/plant-to-wrl-branch.ts');
const body = read('src/modules/mis-email/services/body-sections.ts');

mustNotInclude(compose, 'fullTraceRows', 'compose must not switch body to full-trace when Excel is on');
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
  'buildMisEmailRegionalPerformanceRows',
  'Regional solved/cancelled must come from account merge (not Branch rollup)'
);
mustInclude(
  compose,
  'overlayRegionalOpenFromExcelRows',
  'Regional opens must come from Excel overlay'
);
mustInclude(
  compose,
  'overlayBranchOpenFromExcelRows',
  'Branch opens must come from Excel overlay'
);
mustInclude(
  compose,
  'openTraceRows: needsOpenOverlay',
  'preview and send must pass the same open overlay'
);

mustNotInclude(
  mailBasis,
  'MIS_UNASSIGNED_BRANCH_LABEL',
  'mail-basis must not reintroduce Unassigned open bucket'
);
mustNotInclude(mailBasis, '— Unassigned', 'mail-basis must not label unmapped plants Unassigned');
mustInclude(
  mailBasis,
  'if (!resolved) continue',
  'unmapped plants must be omitted from branch overlay'
);

mustInclude(
  excel,
  'filterTraceRowsForUnifiedOpenExport',
  'Open Calls Excel must use Cadbury-safe unified opens (same as Regional overlay)'
);
mustNotInclude(
  excel,
  'filterTraceRowsForMailBodyOpenExport',
  'Open Calls Excel must not use WRL-drop filter (that undercounted vs Regional)'
);

mustInclude(
  plant,
  'findSapCodeTopLevelBranch',
  '1127/1150-style labels must prefer WRL BRANCH over franchisee officeId'
);

mustInclude(
  body,
  'regionalPerformanceRows !== undefined',
  'body must prefer explicit Regional rows over Branch rollup'
);

console.log('check:mis-mail-formula OK');
