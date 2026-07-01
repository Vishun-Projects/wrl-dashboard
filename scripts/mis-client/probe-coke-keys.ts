import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';

const KEYS = [
  '7181413', '7181496', '7181500', '7181507', '7181530', '7181532',
  '7181715', '7181765', '7181878', '7181883', '7181990', '7182024',
];

async function main() {
  await withAppClient(async (c) => {
    const hist = await c.query(`
      SELECT r.call_key, r.status_bucket, r.raw->>'Call Status' AS raw_status,
             b.file_name, b.created_at, b.batch_id
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code = 'coke' AND r.call_key = ANY($1::text[])
      ORDER BY r.call_key, b.created_at DESC
    `, [KEYS]);
    for (const row of hist.rows) console.log(row);

    const latest = await c.query(`
      SELECT DISTINCT ON (r.call_key)
        r.call_key, r.status_bucket, r.raw->>'Call Status' AS raw_status, b.created_at
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code = 'coke' AND r.call_key = ANY($1::text[])
      ORDER BY r.call_key, b.created_at DESC
    `, [KEYS]);
    console.log('\nLatest per key:');
    for (const row of latest.rows) console.log(row);
  });
}

main().catch(console.error);
