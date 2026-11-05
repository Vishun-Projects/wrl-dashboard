#!/usr/bin/env node
/**
 * Hard lock: MIS mail uses ONE call-level WRL grain.
 *
 * Body Regional + Branch + Summary Excel uiAlign = buildMisEmailMailPerformanceTables(trace).
 * Open Excel = same WRL-mapped opens. Preview HTML === send HTML.
 * No account-merge body, no align hack, no CRM-open fallback, no Unassigned.
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
const attachments = read('src/modules/mis-email/services/build-attachments.ts');
const excel = read('src/modules/mis/services/bd-mis-excel-export.ts');
const plant = read('src/modules/mis/services/plant-to-wrl-branch.ts');

mustNotInclude(compose, 'fullTraceRows', 'compose must not switch body to full-trace when Excel is on');
mustNotInclude(compose, 'Unassigned', 'do not invent an Unassigned branch bucket for opens');
mustNotInclude(
  compose,
  'alignBranchSolvedCancelledToRegional',
  'no zone-align hack (invents cancelled/solved on largest branch)'
);
mustNotInclude(
  compose,
  'buildMisEmailRegionalPerformanceRows',
  'no account-merge Regional body (second source vs Excel)'
);
mustNotInclude(
  compose,
  'overlayRegionalOpenFromExcelRows',
  'no separate regional overlay path'
);
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
  'buildMisEmailMailPerformanceTables',
  'body must use the single mail performance table builder'
);
mustInclude(
  compose,
  'html: preview.html',
  'send must reuse preview HTML (no second body render)'
);
mustInclude(
  compose,
  'mailTables',
  'compose must pass the same tables to body and attachments'
);
mustInclude(
  compose,
  'needsMailTables',
  'mail tables drive body + Summary Excel from one corpus'
);
mustInclude(
  compose,
  'refuse CRM-summary fallback',
  'Summary Excel must not fall back to CRM branchSummary'
);
mustInclude(
  mailBasis,
  'filterTraceRowsForMailBodyOpenExport',
  'body cancelled/open must use the Open Excel filter'
);

mustNotInclude(mailBasis, 'MIS_UNASSIGNED_BRANCH_LABEL', 'no Unassigned open bucket');
mustNotInclude(mailBasis, 'alignBranchSolvedCancelledToRegional', 'align helper must stay deleted');
mustInclude(mailBasis, 'buildMisEmailMailPerformanceTables', 'single mail table builder required');
mustInclude(mailBasis, 'rollupMailBranchesToRegional', 'Regional must roll up from Branch');

mustInclude(
  attachments,
  'mailTablesToSummaryAlign',
  'Summary Excel must use the same mailTables as the body'
);
mustNotInclude(
  attachments,
  'buildMisEmailUnifiedReportAlign',
  'Summary Excel must not use a second uiAlign builder'
);

mustInclude(
  excel,
  'filterTraceRowsForMailBodyOpenExport',
  'Open Calls Excel must use same WRL-mapped opens as body'
);

mustInclude(plant, 'findSapCodeTopLevelBranch', 'SAP 1127/1150 → Guwahati/Ranchi');

console.log('check:mis-mail-formula OK');
