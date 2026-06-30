import 'dotenv/config';
import { PrismaMarketRepository } from '../src/modules/market/infrastructure/PrismaMarketRepository';
import { SyncMarketListingsUseCase } from '../src/modules/market/application/SyncMarketListingsUseCase';

async function main() {
  const repo = new PrismaMarketRepository();
  const useCase = new SyncMarketListingsUseCase(repo);
  const result = await useCase.execute();
  console.log('[Sync Market Catalog] Resultado:', result);
}

main().catch((err) => {
  console.error('[Sync Market Catalog] Error:', err);
  process.exit(1);
});
