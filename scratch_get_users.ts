import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.appUser.findMany();
  console.log('App Users:', users);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
