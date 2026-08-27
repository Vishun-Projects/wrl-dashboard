import assert from 'node:assert/strict';
import { getIstLocalDateStr } from './settings';

/** Maildir extract naming: `{mailKey}_{attachment}.htm` */
function extractMailKeyFromFilename(filename: string): string | null {
  const match = filename.match(/^(.+?)_[^/\\]+\.(htm|html)$/i);
  return match?.[1] ?? null;
}

assert.equal(extractMailKeyFromFilename('1699999999.12345.M1234567890_report.htm'), '1699999999.12345.M1234567890');
assert.equal(extractMailKeyFromFilename('orphan.htm'), null);

const today = getIstLocalDateStr(new Date('2026-08-27T10:00:00+05:30'));
assert.equal(today, '2026-08-27');

console.log('[sap-inbox.test] ok');
