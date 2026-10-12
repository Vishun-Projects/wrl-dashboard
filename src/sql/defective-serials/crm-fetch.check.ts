import assert from 'node:assert/strict';
import { buildDefectiveSerialsCrmSql } from '@/sql/defective-serials/crm-fetch';

const full = buildDefectiveSerialsCrmSql({ top: 500 });
assert.match(full, /trdcalls3parts1serialno/);
assert.match(full, /trhcalls/);
assert.match(full, /breturntobranch/);
assert.match(full, /voldserialno/);
assert.match(full, /return_by_name/);
assert.match(full, /mstusers retuser/);
assert.doesNotMatch(full, /WHERE/);

const page = buildDefectiveSerialsCrmSql({
  editedFrom: '2025-06-21T10:55:51',
  afterNcode: '34853',
  top: 100,
});
assert.match(page, /editedon > '2025-06-21T10:55:51'/);
assert.match(page, /CONVERT\(varchar\(50\), s\.ncode\) > '34853'/);
assert.doesNotMatch(page, /BIGINT/);

console.log('crm-fetch.check: ok');
