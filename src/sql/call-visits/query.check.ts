import assert from 'node:assert/strict';
import { buildCallPartsFilterSql, CALL_PARTS_CATEGORY_JOIN } from '@/sql/call-visits/query';

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
    isHod: true,
    assignedOffices: [] as string[],
  };
}

assert.match(CALL_PARTS_CATEGORY_JOIN, /crm_mstitems i/);
assert.match(CALL_PARTS_CATEGORY_JOIN, /crm_mstitemcategory c/);
assert.match(CALL_PARTS_CATEGORY_JOIN, /i\.norm_vitemcode/);

console.log('call-parts query.check: ok');
