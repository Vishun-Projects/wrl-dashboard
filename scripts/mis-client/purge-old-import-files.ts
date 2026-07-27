/**
 * Delete client-import upload files older than retention (default 7 days).
 * Keeps imported rows; download can reconstruct from raw if needed.
 *
 *   npx tsx scripts/mis-client/purge-old-import-files.ts
 *   npx tsx scripts/mis-client/purge-old-import-files.ts --dry-run
 *   MIS_CLIENT_IMPORT_FILE_RETENTION_DAYS=14 npx tsx scripts/mis-client/purge-old-import-files.ts
 */
import dotenv from 'dotenv';
import path from 'path';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env.mis-upload') });
dotenv.config({ path: path.join(root, '.env.mis-email') });
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

import { purgeExpiredImportStoredFiles } from '@/features/mis-import/lib/purge-old-files';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await purgeExpiredImportStoredFiles({ dryRun });
  console.log(
    JSON.stringify(
      {
        ...result,
        note: dryRun
          ? 'dry-run: no files deleted'
          : 'purged stored upload files; import rows unchanged',
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
