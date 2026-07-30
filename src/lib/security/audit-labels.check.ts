import assert from 'node:assert/strict';
import { actionLabelFor, ACTION_LABELS } from './audit-labels';

assert.equal(actionLabelFor('admin.user.update'), 'Updated user');
assert.equal(actionLabelFor('report.export.complete'), 'Exported report');
assert.equal(actionLabelFor('report.export.cancelled'), 'Cancelled report export');
assert.equal(actionLabelFor('import.mis_client.upload'), 'Finished MIS client import');
assert.equal(actionLabelFor('import.mis_client.upload.start'), 'Started MIS client import');
assert.equal(actionLabelFor('import.mis_client.source.create'), 'Created MIS import source');
assert.equal(actionLabelFor('security.rate_limit.triggered'), 'Rate limit triggered');
assert.equal(actionLabelFor('auth.session.expired'), 'Session expired');
assert.equal(actionLabelFor('sync.schedule.complete'), 'Completed scheduled sync');
assert.equal(actionLabelFor('notification.mis_email.digest.sent'), 'Sent MIS digest email');
assert.equal(actionLabelFor('notification.major_repair.failed'), 'Major-repair alert failed');
assert.equal(actionLabelFor('unknown.event'), 'unknown.event');
assert.ok(ACTION_LABELS['auth.sign_in.success']);
assert.ok(ACTION_LABELS['auth.session.expired']);
assert.ok(ACTION_LABELS['sync.schedule.start']);
assert.ok(ACTION_LABELS['notification.major_repair.sent']);

console.log('audit action labels ok');
