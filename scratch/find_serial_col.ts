import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      top: '1',
      fields: '*',
      tableName: 'uv_findtrhcalls_callsearch'
    });
    const keys = Object.keys(res.data[0]);
    const serialKeys = keys.filter(k => k.toLowerCase().includes('serial'));
    console.log('Serial related keys:', serialKeys);
  } catch (err) {
    console.error(err);
  }
}

inspect();
