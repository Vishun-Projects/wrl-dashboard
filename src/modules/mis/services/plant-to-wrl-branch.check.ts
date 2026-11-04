/**
 * ponytail: one runnable check for SAP-code → WRL branch mapping.
 * Run: npx tsx src/modules/mis/services/plant-to-wrl-branch.check.ts
 */
import type { BranchSummaryRow } from '@/lib/summary/derive';
import { resolveTracePlantToWrlBranch } from '@/modules/mis/services/plant-to-wrl-branch';

function branch(
  officeId: number,
  parentId: number,
  name: string,
  region = 'EAST ZONE'
): BranchSummaryRow {
  return {
    officeId,
    parentId,
    branch: name,
    region,
    total_calls: 0,
    solved_calls: 0,
    cancelled_calls: 0,
    open_calls: 0,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    all_total: 0,
    all_solved: 0,
    all_cancelled: 0,
    all_open: 0,
    all_age_2: 0,
    all_age_3: 0,
    all_age_7: 0,
    all_age_15: 0,
    all_part_pending: 0,
    all_tech_solved: 0,
    tech_solved_calls: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 0,
    population: 0,
    headcount: 0,
  };
}

const tree = [
  branch(32, 612, '1182 - PATNA BRANCH'),
  branch(1127, 32, 'POWER REFRIGERATION'),
  branch(11, 612, '1127 - GUWAHATI BRANCH'),
  branch(50, 612, '1150 - RANCHI BRANCH'),
  branch(1150, 50, '1150 - HIMALAYA REFREGERATIO'),
];

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  resolveTracePlantToWrlBranch('1127 - POWER REFRIGERATION', 'EAST ZONE', tree)?.branch ===
    '1127 - GUWAHATI BRANCH',
  '1127 - POWER REFRIGERATION must map to Guwahati (SAP 1127), not Patna'
);
assert(
  resolveTracePlantToWrlBranch('1127 - GUWAHATI BRANCH', 'EAST ZONE', tree)?.branch ===
    '1127 - GUWAHATI BRANCH',
  'Guwahati label stays Guwahati'
);
assert(
  resolveTracePlantToWrlBranch('POWER REFRIGERATION', 'EAST ZONE', tree)?.branch ===
    '1182 - PATNA BRANCH',
  'bare franchisee name still walks CRM parent → Patna'
);
assert(
  resolveTracePlantToWrlBranch('1150 - HIMALAYA REFREGERATIO', 'EAST ZONE', tree)?.branch ===
    '1150 - RANCHI BRANCH',
  '1150 - Himalaya must map to Ranchi (SAP 1150)'
);
assert(
  resolveTracePlantToWrlBranch('UNKNOWN PLANT', 'EAST ZONE', tree) === null,
  'unmapped plants stay null (no Unassigned bucket)'
);

console.log('plant-to-wrl-branch.check: ok');
