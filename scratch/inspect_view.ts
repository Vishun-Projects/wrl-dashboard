import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      top: '1',
      fields: '*',
      tableName: 'uv_findtrhcalls_callsearch'
    });
    console.log('uv_findtrhcalls_callsearch:', Object.keys(res.data[0]));
    
    // Also check for columns like Deployment and Installation
    const sample = res.data[0];
    console.log('Sample Row Keys:', Object.keys(sample));
  } catch (err) {
    console.error(err);
  }
}

inspect();
