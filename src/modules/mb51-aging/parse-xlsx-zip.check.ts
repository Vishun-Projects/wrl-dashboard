import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  parseMb51XlsxZip,
  parseSharedStringsXml,
  parseSheetRowXml,
} from '@/modules/mb51-aging/parse-xlsx-zip';

assert.deepEqual(parseSharedStringsXml('<sst><si><t>Plant</t></si><si><t>A&amp;B</t></si></sst>'), [
  'Plant',
  'A&B',
]);
assert.deepEqual(
  parseSharedStringsXml('<sst><si><t>Posting&#x20;Date</t></si><si><t>Qty&#x20;in&#x20;unit&#x20;of&#x20;entry</t></si></sst>'),
  ['Posting Date', 'Qty in unit of entry']
);

const row = parseSheetRowXml(
  '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="I2"><v>-1</v></c><c r="E2" t="s"><v>1</v></c></row>',
  ['1126', '1105577']
);
assert.equal(row[0], '1126');
assert.equal(row[4], '1105577');
assert.equal(row[8], -1);

async function buildTinyMb51Xlsx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
     <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
     <Default Extension="xml" ContentType="application/xml"/>
     <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
     <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
     <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
     </Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
     <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
     </Relationships>`
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
     xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
     <sheets><sheet name="MB51" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
     <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
     <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
     </Relationships>`
  );
  // Match MB51_02/03/04 style: spaces as &#x20;
  const strings = [
    'Posting&#x20;Date',
    'Material',
    'Quantity',
    'Plant',
    'MAT-9',
    '1140',
  ];
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">${strings
      .map((s) => `<si><t>${s}</t></si>`)
      .join('')}</sst>`
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
     <sheetData>
     <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
     <row r="2"><c r="A2"><v>45352</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>7</v></c><c r="D2" t="s"><v>5</v></c></row>
     </sheetData></worksheet>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

async function main() {
  const buf = await buildTinyMb51Xlsx();
  const parsed = await parseMb51XlsxZip(buf);
  assert.equal(parsed.rows.length, 1, 'zip parser should yield 1 data row');
  assert.equal(parsed.rows[0].m, 'MAT-9');
  assert.equal(parsed.rows[0].q, 7);
  assert.equal(parsed.rows[0].mv, '1140');
  assert.equal(parsed.rows[0].d, 45352);
  console.log('mb51-aging parse-xlsx-zip check: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
