require('ts-node/register');
const { GetOrRefreshListingFloatsUseCase } = require('./src/modules/market/application/GetOrRefreshListingFloatsUseCase');
const { PrismaMarketRepository } = require('./src/modules/market/infrastructure/PrismaMarketRepository');
const { FloatCachePolicy } = require('./src/modules/market/application/FloatCachePolicy');
const { YoupinFloatAssetsDownloader } = require('./src/modules/market/application/YoupinFloatAssetsDownloader');
const { prisma } = require('./src/shared/infrastructure/PrismaClient');

async function run() {
  const repo = new PrismaMarketRepository();
  const cache = new FloatCachePolicy();
  const downloader = new YoupinFloatAssetsDownloader();
  const useCase = new GetOrRefreshListingFloatsUseCase(repo, cache, downloader);
  
  const list = await prisma.marketListing.findFirst({where: {name: 'AK-47 | Wild Lotus (Factory New)'}});
  if(!list) {
    console.log('List not found');
    return await prisma.$disconnect();
  }
  console.log('Listing ID:', list.id);
  const result = await useCase.execute(list.id);
  console.log('Result type:', typeof result);
  console.log('Floats:', result.floats.length);
  if(result.floats.length > 0) {
    console.log('First float:', result.floats[0]);
  }
  await prisma.$disconnect();
}
run().catch(console.error);
