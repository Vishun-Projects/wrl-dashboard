import { postQuery } from '../src/lib/db-proxy';

async function inspect() {
  try {
    const res = await postQuery({
      fields: "TOP 1 npartyprofile",
      tableName: "mstitemserialno"
    });
    console.log('mstitemserialno has npartyprofile:', res.data);
  } catch (err) {
    console.error(err);
  }
}

inspect();
