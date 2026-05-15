import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      fields: "name",
      tableName: "sys.tables",
      condition: "name LIKE '%install%'"
    });
    console.log('Installation Tables:', res.data);
  } catch (err) {
    console.error(err);
  }
}

inspect();
