/**
 * MIS email CLI env — .env.mis-email wins over repo Prisma dev .env files.
 */
import dotenv from 'dotenv';
import path from 'path';

const root = process.cwd();
if (process.env.DATABASE_URL?.includes('prisma+postgres')) {
  delete process.env.DATABASE_URL;
}
dotenv.config({ path: path.join(root, '.env.mis-email'), override: true });
// VPS uses Supavisor pooler (6543 + postgres.TENANT user), not plain postgres@5432
