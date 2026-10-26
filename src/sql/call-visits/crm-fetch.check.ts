import assert from 'node:assert/strict';
import { buildCallPartsCrmSql } from '@/sql/call-visits/crm-fetch';

const full = buildCallPartsCrmSql({ top: 500 });
assert.match(full, /SELECT TOP 500/);
assert.match(full, /FROM trdcalls3parts p \(NOLOCK\)/);
assert.match(full, /trdcalls3parts1serialno s \(NOLOCK\)/);
assert.match(full, /s\.vnewserialno AS new_serial/);
assert.doesNotMatch(full, /vserialno/);
assert.match(full, /trdcalls1visit vis \(NOLOCK\)/);
assert.match(full, /vis\.ncode = p\.ncalls1/);
assert.match(full, /vis\.vVisitTrnNo AS visit_no/);
assert.match(full, /CONVERT\(varchar\(10\), vis\.dvisitdatetime, 23\) AS visit_at/);
assert.match(full, /ORDER BY ISNULL\(p\.editedon, p\.addedon\) ASC, p\.ncode ASC/);
assert.doesNotMatch(full, /tc\.dtrndate >=/);
assert.doesNotMatch(full, /p\.editedon, p\.addedon\) >/);

const page = buildCallPartsCrmSql({
  editedFrom: '2025-06-21T10:55:51',
  afterNcode: '34853',
  top: 100,
});
assert.match(page, /SELECT TOP 100/);
assert.match(page, /ISNULL\(p\.editedon, p\.addedon\) > '2025-06-21T10:55:51'/);
assert.match(page, /CONVERT\(varchar\(50\), p\.ncode\) > '34853'/);

const capped = buildCallPartsCrmSql({ top: 99_999 });
assert.match(capped, /SELECT TOP 2000/);

const month = buildCallPartsCrmSql({ callFrom: '2026-10-01', callTo: '2026-11-01', top: 500 });
assert.match(month, /tc\.dtrndate >= '2026-10-01'/);
assert.match(month, /tc\.dtrndate < '2026-11-01'/);

console.log('call-parts crm-fetch.check: ok');
