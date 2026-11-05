#!/usr/bin/env node
/**
 * Hard lock: MIS mail body — Regional ≡ Branch rollup; opens ≡ Excel.
 *
 * Branch = CRM offices rolled to WRL + import solved/cancelled + Excel open overlay.
 * Regional = that Branch rollup. Open Excel = same WRL-mapped opens.
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
  'overlayRegionalOpenFromExcelRows',
  'Regional must be Branch rollup — not a second zone overlay path'
);
mustNotInclude(
  compose,
  'buildMisEmailRegionalPerformanceRows',
  'Regional must not use separate account-merge path (breaks Branch parity)'
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
  'buildMisEmailWrlBranchBase',
  'Branch base must roll CRM offices to WRL + import solved'
);
mustInclude(
  compose,
  'rollupVisibleBranchesToRegional',
  'Regional must be Branch rollup'
);
mustInclude(
  compose,
  'Regional open (',
  'compose must assert Regional open ≡ Branch rollup open'
);
mustInclude(
  compose,
  'openTraceRows: needsOpenOverlay',
  'preview and send must pass the same open overlay'
);

mustNotInclude(mailBasis, 'MIS_UNASSIGNED_BRANCH_LABEL', 'no Unassigned open bucket');
mustNotInclude(mailBasis, '— Unassigned', 'no Unassigned open bucket');
mustInclude(mailBasis, 'buildMisEmailWrlBranchBase', 'WRL branch base builder required');
mustInclude(mailBasis, 'isMailBodyHiddenBranch(resolved.branch)', 'hidden WRL opens omitted from overlay');

mustInclude(
  excel,
  'filterTraceRowsForMailBodyOpenExport',
  'Open Calls Excel must use same WRL-mapped opens as body'
);
mustNotInclude(
  excel,
  'filterTraceRowsForUnifiedOpenExport(payload.traceRows)',
  'Open Calls Excel must not use unmapped unified opens'
);

mustInclude(plant, 'rollupCrmOfficesToWrlBranches', 'franchisee offices must roll into WRL parents');
mustInclude(plant, 'findSapCodeTopLevelBranch', 'SAP 1127/1150 → Guwahati/Ranchi');

mustInclude(
  body,
  'branchPerformanceRows !== undefined',
  'body Regional prefers Branch rollup when Branch rows exist'
);

console.log('check:mis-mail-formula OK');
