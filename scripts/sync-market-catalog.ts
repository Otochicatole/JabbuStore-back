import 'dotenv/config';
import { PrismaMarketRepository } from '../src/modules/market/infrastructure/PrismaMarketRepository';
import { PrismaMarketSyncStateRepository } from '../src/modules/market/infrastructure/PrismaMarketSyncStateRepository';
import { SyncMarketListingsUseCase } from '../src/modules/market/application/SyncMarketListingsUseCase';

async function main() {
  const repo = new PrismaMarketRepository();
  const syncStateRepo = new PrismaMarketSyncStateRepository();
  const useCase = new SyncMarketListingsUseCase(repo, syncStateRepo);
  const result = await useCase.execute();
  console.log('[Sync Market Catalog] Resultado:', result);
}

main().catch((err) => {
  console.error('[Sync Market Catalog] Error:', err);
  process.exit(1);
});
