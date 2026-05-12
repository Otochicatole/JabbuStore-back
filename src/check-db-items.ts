import { prisma } from './shared/infrastructure/PrismaClient';

async function main() {
  console.log('--- DB ITEMS DIAGNOSTIC ---');

  try {
    const items = await prisma.storeItem.findMany();
    console.log(`Total items in StoreItem database: ${items.length}`);

    const dopplers = items.filter(item => item.name.includes('Doppler'));
    console.log(`\nFound ${dopplers.length} Doppler / Gamma Doppler items:`);

    for (const d of dopplers) {
      console.log(`- AssetID: ${d.assetId}`);
      console.log(`  Name: "${d.name}"`);
      console.log(`  Price: $${d.price} USD`);
      console.log(`  Float: ${d.float}`);
      console.log(`  Pattern: ${d.pattern}`);
      console.log('-------------------------');
    }
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
