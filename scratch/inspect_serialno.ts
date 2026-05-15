import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      top: '1',
      fields: 'TOP 1 *',
      tableName: 'mstitemserialno'
    });
    if (res.data && res.data.length > 0) {
      console.log('mstitemserialno:', Object.keys(res.data[0]));
    } else {
      console.log('No data found in mstitemserialno');
    }
  } catch (err) {
    console.error(err);
  }
}

inspect();
