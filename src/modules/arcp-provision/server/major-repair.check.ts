import assert from 'node:assert/strict';
import {
  isBreakdownCallType,
  isProvisionMajorRepair,
  resolveProvisionIsMajor,
} from './major-repair';

assert.equal(isBreakdownCallType('BREAKDOWN', '35'), true);
assert.equal(isBreakdownCallType('INSTALLATION CALL', '38'), false);
assert.equal(isProvisionMajorRepair('6', null), true);
assert.equal(isProvisionMajorRepair('19', 'Compressor Replaced'), true);
assert.equal(isProvisionMajorRepair('34', 'Gas Charging by WRL Technician'), false);
assert.equal(isProvisionMajorRepair(null, 'Gas Charging Done'), true);

assert.equal(
  resolveProvisionIsMajor({
    callTypeLabel: 'BREAKDOWN',
    ncalltype: '35',
    nrepairtype: '6',
    repairLabel: 'Gas Charging Done',
    crmIsMajor: false,
  }),
  true
);
assert.equal(
  resolveProvisionIsMajor({
    callTypeLabel: 'BREAKDOWN',
    ncalltype: '35',
    nrepairtype: '14',
    repairLabel: 'Installation Done',
    crmIsMajor: true,
  }),
  false
);
assert.equal(
  resolveProvisionIsMajor({
    callTypeLabel: 'INSTALLATION CALL',
    ncalltype: '38',
    nrepairtype: null,
    repairLabel: null,
    crmIsMajor: true,
  }),
  true
);

console.log('arcp-provision major-repair check ok');
