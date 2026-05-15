import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      top: '1',
      fields: '*',
      tableName: 'mstoffice'
    });
    console.log('mstoffice:', Object.keys(res.data[0]));
    
    const res2 = await postQuery({
      top: '1',
      fields: '*',
      tableName: 'mstzones'
    });
    console.log('mstzones:', Object.keys(res2.data[0]));
  } catch (err) {
    console.error(err);
  }
}

inspect();
