
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.local.DATABASE_URL
    }
  }
});

async function main() {
  console.log('Using DB URL:', process.env.DATABASE_URL?.substring(0, 20) + '...');
  const result = await prisma.$queryRawUnsafe('SELECT office_id, count(*) as count FROM public.calls_cache GROUP BY office_id');
  console.log('Record counts by office:', JSON.stringify(result, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
