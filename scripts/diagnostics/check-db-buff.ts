import { prisma } from '../../src/shared/infrastructure/PrismaClient';

async function main() {
  console.log('--- DB MARKET LISTINGS DIAGNOSTIC ---');
  try {
    const totalListings = await prisma.marketListing.count();
    const youpinCount = await prisma.marketListing.count({
      where: { youpinAsk: { not: null } }
    });
    const buffCount = await prisma.marketListing.count({
      where: { buffAsk: { not: null } }
    });

    console.log(`Total listings in MarketListing table: ${totalListings}`);
    console.log(`Listings with YouPin prices: ${youpinCount}`);
    console.log(`Listings with Buff prices: ${buffCount}`);

    const sampleBuff = await prisma.marketListing.findFirst({
      where: { buffAsk: { not: null } },
      select: { name: true, price: true, buffAsk: true, youpinAsk: true, provider: true }
    });

    if (sampleBuff) {
      console.log('\nSample listing with Buff price:', sampleBuff);
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
