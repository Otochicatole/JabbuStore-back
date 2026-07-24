import { prisma } from '../../src/shared/infrastructure/PrismaClient';

async function main() {
  const listingsCount = await prisma.marketListing.count({
    where: { provider: 'youpin' }
  });
  const floatsCount = await prisma.floatItem.count({
    where: { market: 'YOUPIN' }
  });
  console.log(`YouPin database listings count: ${listingsCount}`);
  console.log(`YouPin database floats count: ${floatsCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
