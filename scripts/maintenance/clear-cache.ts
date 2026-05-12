import { prisma } from '../../src/shared/infrastructure/PrismaClient';

async function main() {
  const result = await prisma.userInventoryItem.deleteMany();
  console.log(`[Clean Up] Deleted ${result.count} mock/cached inventory items from the database!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
