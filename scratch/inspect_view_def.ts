import { postQuery } from '../src/lib/db-proxy';
import * as fs from 'fs';

async function run() {
  try {
    const r = await postQuery({
      fields: 'definition',
      tableName: 'sys.sql_modules m JOIN sys.objects o ON m.object_id = o.object_id',
      condition: "o.name = 'uv_findtrhcalls_callsearch'"
    });
    const def = r.data?.[0]?.definition || 'Not found';
    fs.writeFileSync('./scratch/view_def.sql', def);
    console.log("View definition written successfully, length:", def.length);
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}
run();
