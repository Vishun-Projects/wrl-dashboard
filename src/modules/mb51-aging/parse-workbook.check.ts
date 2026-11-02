import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  buildMb51TemplateCsv,
  formatMb51ParseFailure,
  normHeader,
  parseMb51Workbook,
  parseQty,
  toPostingSerial,
} from '@/modules/mb51-aging/parse-workbook';

assert.equal(normHeader('Amt.in Loc.Cur.'), 'amtinloccur');
assert.equal(normHeader('Material Doc. Year'), 'materialdocyear');
assert.equal(normHeader('Base Unit of Measure'), 'baseunitofmeasure');
assert.equal(normHeader('Qty in unit of entry'), 'qtyinunitofentry');

assert.equal(toPostingSerial('01.04.2025'), toPostingSerial('2025-04-01'));
assert.equal(parseQty('1,234.5'), 1234.5);
assert.equal(parseQty('(12)'), -12);

const sap = buildMb51TemplateCsv('sap');
const wbSap = XLSX.read(sap.csv, { type: 'string' });
const parsedSap = parseMb51Workbook(wbSap, wbSap.SheetNames);
assert.equal(parsedSap.rows.length, 1, 'SAP template should parse 1 sample row');
assert.equal(parsedSap.rows[0].m, 'MAT-001');
assert.equal(parsedSap.rows[0].q, 2);
assert.equal(parsedSap.rows[0].mv, '1140');
assert.equal(parsedSap.rows[0].dc, '4900123456');

const alt = buildMb51TemplateCsv('qty-entry');
const wbAlt = XLSX.read(alt.csv, { type: 'string' });
const parsedAlt = parseMb51Workbook(wbAlt, wbAlt.SheetNames);
assert.equal(parsedAlt.rows.length, 1, 'Qty-entry template should parse 1 sample row');

const bad = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  bad,
  XLSX.utils.aoa_to_sheet([
    ['Foo', 'Bar'],
    ['1', '2'],
  ]),
  'Sheet1'
);
const failed = parseMb51Workbook(bad, ['Sheet1']);
assert.equal(failed.rows.length, 0);
const msg = formatMb51ParseFailure(failed);
assert.match(msg, /Posting Date/i);
assert.doesNotMatch(msg, /^No usable rows found\.$/);

// Title row above real headers
const titled = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  titled,
  XLSX.utils.aoa_to_sheet([
    ['MB51 Export'],
    [
      'Plant',
      'Material Document',
      'Posting Date',
      'Material',
      'Quantity',
      'Base Unit of Measure',
    ],
    ['1140', '4900', '01.04.2025', 'M1', '3', 'EA'],
  ]),
  'Data'
);
const parsedTitle = parseMb51Workbook(titled, ['Data']);
assert.equal(parsedTitle.rows.length, 1);
assert.equal(parsedTitle.rows[0].q, 3);

console.log('mb51-aging parse-workbook check: ok');
