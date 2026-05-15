import { postQuery } from '../src/lib/db-proxy';

async function test() {
  try {
    const res = await postQuery({
      fields: 'TOP 5 nofficeid, cname, nunder',
      tableName: 'mstoffice'
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
}

test();
