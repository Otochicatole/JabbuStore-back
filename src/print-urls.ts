import { prisma } from './shared/infrastructure/PrismaClient';

async function main() {
  const items = await prisma.storeItem.findMany();
  const dopplers = items.filter(item => item.name.includes('Doppler'));
  for (const d of dopplers) {
    console.log(`Name: "${d.name}"`);
    console.log(`IconUrl: "${d.iconUrl}"`);
    console.log('-------------------------');
  }
}

main();
