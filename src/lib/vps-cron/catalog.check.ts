import assert from 'node:assert/strict';
import { isVpsCronJobId, VPS_CRON_CATALOG, VPS_CRON_JOB_IDS } from './catalog';

assert.equal(VPS_CRON_JOB_IDS.length, 4);
assert.equal(VPS_CRON_CATALOG.length, 4);
assert.ok(isVpsCronJobId('mis_email_digest'));
assert.ok(isVpsCronJobId('mis_email_test'));
assert.ok(!isVpsCronJobId('nope'));
assert.ok(VPS_CRON_CATALOG.every((j) => isVpsCronJobId(j.id) && j.label && j.schedule));

console.log('vps-cron catalog ok');
