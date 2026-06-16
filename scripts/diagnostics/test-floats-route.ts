import { prisma } from '../../src/shared/infrastructure/PrismaClient';
import { GetResaleItemFloatsUseCase } from '../../src/modules/market/application/GetResaleItemFloatsUseCase';
import { PrismaMarketRepository } from '../../src/modules/market/infrastructure/PrismaMarketRepository';

async function main() {
  console.log('--- TESTING FLOATS ROUTE ---');
  try {
    const listing = await prisma.marketListing.findFirst({
      where: {
        OR: [
          { name: { contains: 'Field-Tested' } },
          { name: { contains: 'Factory New' } },
          { name: { contains: 'Minimal Wear' } },
          { name: { contains: 'Well-Worn' } },
          { name: { contains: 'Battle-Scarred' } },
        ]
      },
      select: { id: true, name: true }
    });

    if (!listing) {
      console.log('No listings found in MarketListing table.');
      return;
    }

    console.log(`Found listing: ID="${listing.id}", Name="${listing.name}"`);

    const marketRepository = new PrismaMarketRepository();
    const useCase = new GetResaleItemFloatsUseCase(marketRepository);

    console.log('Executing GetResaleItemFloatsUseCase...');
    const result = await useCase.execute(`market-${listing.name}`);
    console.log(`Success! Fetched ${result.length} floats.`);
    if (result.length > 0) {
      console.log('Sample result:', result[0]);
    }
  } catch (err: any) {
    console.error('Error during execution:', err.message || err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
