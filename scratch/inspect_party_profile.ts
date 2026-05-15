import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      top: '1',
      fields: '*',
      tableName: 'mstpartyprofile'
    });
    console.log('Columns in mstpartyprofile:', Object.keys(res.data[0]));
  } catch (err) {
    console.error(err);
  }
}

inspect();
