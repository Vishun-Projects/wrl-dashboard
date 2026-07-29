import assert from 'node:assert/strict';
import { actionLabelFor, ACTION_LABELS } from './audit-labels';

assert.equal(actionLabelFor('admin.user.update'), 'Updated user');
assert.equal(actionLabelFor('report.export.complete'), 'Exported report');
assert.equal(actionLabelFor('report.export.cancelled'), 'Cancelled report export');
assert.equal(actionLabelFor('import.mis_client.upload'), 'Finished MIS client import');
assert.equal(actionLabelFor('import.mis_client.upload.start'), 'Started MIS client import');
assert.equal(actionLabelFor('import.mis_client.source.create'), 'Created MIS import source');
assert.equal(actionLabelFor('unknown.event'), 'unknown.event');
assert.ok(ACTION_LABELS['auth.sign_in.success']);

console.log('audit action labels ok');
