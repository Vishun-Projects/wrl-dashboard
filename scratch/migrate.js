const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runSql() {
  try {
    console.log("Running migration for cached details...");
    
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.cached_visits (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        call_id text NOT NULL,
        office_id text NOT NULL,
        person_contacted text,
        visit_date timestamp with time zone,
        remark text,
        duration integer,
        expense numeric,
        created_at timestamp with time zone DEFAULT now()
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.cached_parts (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        call_id text NOT NULL,
        office_id text NOT NULL,
        part_name text,
        part_code text,
        quantity integer,
        created_at timestamp with time zone DEFAULT now()
      );
    `);

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cached_visits_call ON public.cached_visits(call_id, office_id);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cached_parts_call ON public.cached_parts(call_id, office_id);`);

    console.log("Migration successful!");
  } catch (e) {
    console.error("Migration failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

runSql();
