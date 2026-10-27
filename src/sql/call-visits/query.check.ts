import assert from 'node:assert/strict';
import {
  buildCallPartsFilterSql,
  CALL_PARTS_CATEGORY_JOIN,
  CALL_PARTS_SAP_CTE,
  SAP_DOC_BLANK,
  SAP_DOC_HAS,
  sapDocOuterSql,
} from '@/sql/call-visits/query';

const dated = buildCallPartsFilterSql({
  allTime: false,
  startDate: '2026-10-01',
  endDate: '2026-10-26',
  search: 'SO_1%',
  plant: '',
  branch: 'AMAL MAITY',
  client: '',
  customer: '',
  engineer: '',
  status: '',
  part: 'compressor',
  category: '',
  sapDoc: '',
  isHod: false,
  assignedOffices: ['12', '18'],
});
assert.match(dated.where, /h\.logged_at/);
assert.match(dated.where, /\$2::date/);
assert.equal(dated.params[0], '2026-10-01');
assert.equal(dated.params[2], '%SO\\_1\\%%');
assert.ok(dated.where.includes('franchisee_name'));
assert.ok(dated.where.includes('p.part_name ILIKE $5'));
assert.ok(dated.where.includes('nofficeid = ANY($6::text[])'));
assert.deepEqual(dated.params[5], ['12', '18']);
assert.doesNotMatch(dated.where, /call_visits/);

const all = buildCallPartsFilterSql({
  allTime: true,
  startDate: '2026-10-01',
  endDate: '2026-10-26',
  search: '',
  plant: '',
  branch: '',
  client: '',
  customer: '',
  engineer: '',
  status: '',
  part: '',
  category: '',
  sapDoc: '',
  isHod: true,
  assignedOffices: [],
});
assert.match(all.where, /BREAKDOWN/);
assert.equal(all.params.length, 0);

const byStatus = buildCallPartsFilterSql({ ...allInput(), status: 'Closed' });
const byCategory = buildCallPartsFilterSql({ ...allInput(), category: 'Compressor' });
assert.match(byCategory.where, /part_cat\.item_category/);
assert.equal(byCategory.params[0], 'COMPRESSOR');
assert.match(byStatus.where, /status_label/);
assert.equal(byStatus.params[0], 'CLOSED');

function allInput() {
  return {
    allTime: true,
    startDate: '2026-10-01',
    endDate: '2026-10-26',
    search: '',
    plant: '',
    branch: '',
    client: '',
    customer: '',
    engineer: '',
    status: '',
    part: '',
    category: '',
    sapDoc: '',
    isHod: true,
    assignedOffices: [] as string[],
  };
}

assert.match(CALL_PARTS_CATEGORY_JOIN, /crm_mstitems i/);
assert.match(CALL_PARTS_CATEGORY_JOIN, /crm_mstitemcategory c/);
assert.match(CALL_PARTS_CATEGORY_JOIN, /i\.norm_vitemcode/);

const sapParams: unknown[] = [];
assert.equal(sapDocOuterSql(SAP_DOC_HAS, sapParams), 'sap_doc_defective IS NOT NULL');
assert.equal(sapDocOuterSql(SAP_DOC_BLANK, sapParams), 'sap_doc_defective IS NULL');
assert.equal(sapDocOuterSql('4908_1%', sapParams), `sap_doc_defective ILIKE $1 ESCAPE '\\'`);
assert.equal(sapParams[0], '%4908\\_1\\%%');
assert.match(CALL_PARTS_SAP_CTE, /2303393/);
assert.match(CALL_PARTS_SAP_CTE, /MOTOR/);
assert.match(CALL_PARTS_SAP_CTE, /947/);
assert.match(CALL_PARTS_SAP_CTE, /IN \('947'/);

console.log('call-parts query.check: ok');
