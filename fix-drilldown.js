const fs = require('fs');
const path = 'src/app/api/report/drilldown/route.ts';
let content = fs.readFileSync(path, 'utf8');

// Replace both occurrences of vtrnno selection to include call_ncode
content = content.replace(/tc\.vtrnno as vtrnno,/g, 'tc.ncode as call_ncode,\n                    tc.vtrnno as vtrnno,');

// Replace part_pending condition
content = content.replace(
  /AND \(view_c\.vsolveremarks LIKE '%PART%' OR \(view_c\.vcomplaint LIKE '%PART%' AND view_c\.vcomplaint NOT LIKE 'Cut off, cooling, part problem%'\)\)/g,
  "AND (view_c.vsolveremarks LIKE '%PART%' OR (view_c.vcomplaint LIKE '%PART%' AND (view_c.vcomplaint NOT LIKE 'Cut off, cooling, part problem%' OR EXISTS(SELECT 1 FROM trdcalls1visit v (NOLOCK) WHERE v.ncalls = view_c.call_ncode))))"
);

fs.writeFileSync(path, content);
console.log("Replaced successfully!");
