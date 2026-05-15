import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      top: '1',
      fields: '*',
      tableName: 'uv_findtrhcalls_callsearch'
    });
    const keys = Object.keys(res.data[0]);
    console.log(JSON.stringify(keys, null, 2));
  } catch (err) {
    console.error(err);
  }
}

inspect();
