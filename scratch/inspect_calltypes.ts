import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      fields: 'DISTINCT calltype',
      tableName: 'uv_findtrhcalls_callsearch'
    });
    console.log('Call Types:', res.data);
  } catch (err) {
    console.error(err);
  }
}

inspect();
