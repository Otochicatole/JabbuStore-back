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
  const list = await prisma.marketListing.findFirst();
  console.log('Listing ID:', list.id);
  const result = await useCase.execute(list.id);
  console.log('First float:', result.floats[0]);
  await prisma.$disconnect();
}
run().catch(console.error);
